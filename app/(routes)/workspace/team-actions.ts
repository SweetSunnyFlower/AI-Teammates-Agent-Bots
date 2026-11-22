"use server";

import { z } from "zod";
import {
  botSchema,
  deleteDepartmentSchema,
  departmentSchema,
  fieldErrors,
  type BotInput,
  type DepartmentInput,
} from "@/lib/office/schemas";
import { hasDatabaseEnv } from "@/lib/db/env";
import { createClient } from "@/lib/db/server";
import { hasJobQueue, startTaskRun } from "@/lib/runs/start";
import { releaseStaleRuns } from "@/lib/runs/recover";
import { createAdminClient } from "@/lib/db/admin";

export type ActionResult = { ok: true; id?: string } | { ok: false; error: string; fieldErrors?: Record<string, string> };

const uuid = z.string().uuid();

async function getUserDatabaseClient() {
  if (!hasDatabaseEnv) throw new Error("数据库尚未配置，请在 .env.local 中添加 DATABASE_URL。");
  return createClient();
}

/** Turn database errors into something a person can act on (rule messages come from our triggers). */
function friendly(message: string) {
  if (/fetch failed|network|ENOTFOUND|EAI_AGAIN|ECONN/i.test(message)) {
    return "无法连接数据库，请检查网络后重试。";
  }
  if (message.includes("bots_one_lead_per_department")) return "这个楼层已经有主管了。";
  if (message.includes("departments_workspace_floor_unique")) return "两个楼层被安排到了同一层，请重试。";
  if (message.includes("floor_index")) return "一栋楼最多只能有 20 层。";
  if (message.includes("don't have access")) return "你没有这个工作空间的访问权限。";
  return message;
}

async function run(fn: () => Promise<ActionResult>): Promise<ActionResult> {
  try {
    return await fn();
  } catch (e) {
    return { ok: false, error: friendly(e instanceof Error ? e.message : "出了点问题，请重试。") };
  }
}

// ─── Departments (floors) ─────────────────────────────────────────────────────────────────────
export async function saveDepartment(workspaceId: string, departmentId: string | null, input: DepartmentInput): Promise<ActionResult> {
  return run(async () => {
    const parsed = departmentSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "请检查标红的字段。", fieldErrors: fieldErrors(parsed.error) };
    if (!uuid.safeParse(workspaceId).success) return { ok: false, error: "工作空间不存在。" };
    const v = parsed.data;
    const databaseClient = await getUserDatabaseClient();

    if (!departmentId) {
      const { data, error } = await databaseClient.rpc("create_department", {
        p_workspace_id: workspaceId,
        p_name: v.name,
        p_color: v.color,
        p_description: v.description,
        p_kind: v.kind,
      });
      if (error) return { ok: false, error: friendly(error.message) };
      return { ok: true, id: data as string };
    }

    // The Head office keeps its type; everything else can change style.
    const { data: current } = await databaseClient.from("departments").select("kind").eq("id", departmentId).maybeSingle();
    if (!current) return { ok: false, error: "这个楼层已不存在。" };
    const { error } = await databaseClient
      .from("departments")
      .update({ name: v.name, color: v.color, description: v.description, ...(current.kind === "head" ? {} : { kind: v.kind }) })
      .eq("id", departmentId)
      .eq("workspace_id", workspaceId);
    if (error) return { ok: false, error: friendly(error.message) };
    return { ok: true, id: departmentId };
  });
}

/** `bottomUp`: every non-Head floor id, ground floor first. The Head office stays on top. */
export async function reorderDepartments(workspaceId: string, bottomUp: string[]): Promise<ActionResult> {
  return run(async () => {
    if (!uuid.safeParse(workspaceId).success || !z.array(uuid).max(20).safeParse(bottomUp).success) {
      return { ok: false, error: "楼层顺序无效。" };
    }
    const databaseClient = await getUserDatabaseClient();
    const { error } = await databaseClient.rpc("reorder_departments", { p_workspace_id: workspaceId, p_bottom_up: bottomUp });
    if (error) return { ok: false, error: friendly(error.message) };
    return { ok: true };
  });
}

export async function deleteDepartment(departmentId: string, moveBotsTo: string | null): Promise<ActionResult> {
  return run(async () => {
    const parsed = deleteDepartmentSchema.safeParse({ departmentId, moveBotsTo });
    if (!parsed.success) return { ok: false, error: "请选择 Bot 要移动到的楼层。" };
    const databaseClient = await getUserDatabaseClient();
    const { error } = await databaseClient.rpc("delete_department", {
      p_department_id: parsed.data.departmentId,
      p_move_bots_to: parsed.data.moveBotsTo,
    });
    if (error) return { ok: false, error: friendly(error.message) };
    return { ok: true };
  });
}

// ─── Bots ─────────────────────────────────────────────────────────────────────────────────────
export async function saveBot(workspaceId: string, botId: string | null, input: BotInput): Promise<ActionResult> {
  return run(async () => {
    const parsed = botSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "请检查标红的字段。", fieldErrors: fieldErrors(parsed.error) };
    if (!uuid.safeParse(workspaceId).success || (botId && !uuid.safeParse(botId).success)) {
      return { ok: false, error: "Bot 或工作空间不存在。" };
    }
    const v = parsed.data;
    const databaseClient = await getUserDatabaseClient();
    const { data, error } = await databaseClient.rpc("save_bot", {
      p_workspace_id: workspaceId,
      p_bot_id: botId,
      p_department_id: v.departmentId,
      p_role: v.role,
      p_name: v.name,
      p_instructions: v.instructions,
      p_tool_keys: v.tools,
      p_avatar: { shape: v.shape, color: v.color.toLowerCase() },
      p_model: v.model,
      p_app_keys: v.apps.includes("*") ? ["*"] : [...new Set(v.apps)],
    });
    if (error) return { ok: false, error: friendly(error.message) };
    return { ok: true, id: data as string };
  });
}

/** Retry a failed task: back to the backlog and a fresh background run. */
export async function retryTask(taskId: string): Promise<ActionResult> {
  return run(async () => {
    if (!uuid.safeParse(taskId).success) return { ok: false, error: "任务不存在。" };
    const databaseClient = await getUserDatabaseClient();
    const { data: task } = await databaseClient.from("tasks").select("id, workspace_id, status, assignee_bot_id").eq("id", taskId).maybeSingle();
    if (!task) return { ok: false, error: "任务不存在，或者你没有访问权限。" };
    if (!["failed", "backlog", "doing"].includes(task.status)) return { ok: false, error: "只有失败、等待中或卡住的任务可以重新启动。" };
    if (!hasJobQueue()) return { ok: false, error: "后台任务尚未启用，请配置 DATABASE_URL 并启动 worker。" };
    // A "doing" task may just be busy — only restart it if its run has really stopped.
    if (await releaseStaleRuns(createAdminClient(), task.id)) return { ok: false, error: "这个任务仍在处理中，请稍等。" };
    const { error } = await databaseClient.from("tasks").update({ status: "backlog", result: null }).eq("id", taskId);
    if (error) return { ok: false, error: friendly(error.message) };
    if (!task.assignee_bot_id) return { ok: false, error: "请先为任务指定一个 Bot。" };
    await startTaskRun({ id: task.id, workspaceId: task.workspace_id, assigneeBotId: task.assignee_bot_id }, `retry-${Date.now()}`);
    return { ok: true };
  });
}

export async function deleteBot(workspaceId: string, botId: string): Promise<ActionResult> {
  return run(async () => {
    if (!uuid.safeParse(workspaceId).success || !uuid.safeParse(botId).success) return { ok: false, error: "Bot 不存在。" };
    const databaseClient = await getUserDatabaseClient();
    // The Head bot is protected by a database trigger as well.
    const { error, count } = await databaseClient
      .from("bots")
      .delete({ count: "exact" })
      .eq("id", botId)
      .eq("workspace_id", workspaceId)
      .neq("role", "head");
    if (error) return { ok: false, error: friendly(error.message) };
    if (!count) return { ok: false, error: "总控 Bot 不能删除。" };
    return { ok: true };
  });
}
