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
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import { hasTrigger, startTaskRun } from "@/lib/runs/start";
import { releaseStaleRuns } from "@/lib/runs/recover";
import { createAdminClient } from "@/lib/supabase/admin";

export type ActionResult = { ok: true; id?: string } | { ok: false; error: string; fieldErrors?: Record<string, string> };

const uuid = z.string().uuid();

async function client() {
  if (!hasSupabaseEnv) throw new Error("Supabase isn't configured yet — add your keys to .env.local.");
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims?.sub) throw new Error("Your session expired — sign in again.");
  return supabase;
}

/** Turn database errors into something a person can act on (rule messages come from our triggers). */
function friendly(message: string) {
  if (/fetch failed|network|ENOTFOUND|EAI_AGAIN|ECONN/i.test(message)) {
    return "Couldn't reach Supabase — check your internet connection and try again.";
  }
  if (message.includes("bots_one_lead_per_department")) return "That floor already has a Lead.";
  if (message.includes("departments_workspace_floor_unique")) return "Two floors ended up on the same level — try again.";
  if (message.includes("floor_index")) return "A building can have at most 20 floors.";
  if (message.includes("row-level security")) return "You don't have access to that workspace.";
  return message;
}

async function run(fn: () => Promise<ActionResult>): Promise<ActionResult> {
  try {
    return await fn();
  } catch (e) {
    return { ok: false, error: friendly(e instanceof Error ? e.message : "Something went wrong.") };
  }
}

// ─── Departments (floors) ─────────────────────────────────────────────────────────────────────
export async function saveDepartment(workspaceId: string, departmentId: string | null, input: DepartmentInput): Promise<ActionResult> {
  return run(async () => {
    const parsed = departmentSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Check the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };
    if (!uuid.safeParse(workspaceId).success) return { ok: false, error: "Unknown workspace." };
    const v = parsed.data;
    const supabase = await client();

    if (!departmentId) {
      const { data, error } = await supabase.rpc("create_department", {
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
    const { data: current } = await supabase.from("departments").select("kind").eq("id", departmentId).maybeSingle();
    if (!current) return { ok: false, error: "That floor no longer exists." };
    const { error } = await supabase
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
      return { ok: false, error: "Invalid floor order." };
    }
    const supabase = await client();
    const { error } = await supabase.rpc("reorder_departments", { p_workspace_id: workspaceId, p_bottom_up: bottomUp });
    if (error) return { ok: false, error: friendly(error.message) };
    return { ok: true };
  });
}

export async function deleteDepartment(departmentId: string, moveBotsTo: string | null): Promise<ActionResult> {
  return run(async () => {
    const parsed = deleteDepartmentSchema.safeParse({ departmentId, moveBotsTo });
    if (!parsed.success) return { ok: false, error: "Pick where the bots should go." };
    const supabase = await client();
    const { error } = await supabase.rpc("delete_department", {
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
    if (!parsed.success) return { ok: false, error: "Check the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };
    if (!uuid.safeParse(workspaceId).success || (botId && !uuid.safeParse(botId).success)) {
      return { ok: false, error: "Unknown bot or workspace." };
    }
    const v = parsed.data;
    const supabase = await client();
    const { data, error } = await supabase.rpc("save_bot", {
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
    if (!uuid.safeParse(taskId).success) return { ok: false, error: "Unknown task." };
    const supabase = await client();
    const { data: task } = await supabase.from("tasks").select("id, workspace_id, status, assignee_bot_id").eq("id", taskId).maybeSingle();
    if (!task) return { ok: false, error: "That task doesn't exist or isn't yours." };
    if (!["failed", "backlog", "doing"].includes(task.status)) return { ok: false, error: "Only failed, waiting or stuck tasks can be restarted." };
    if (!hasTrigger()) return { ok: false, error: "Background runs aren't set up yet — add the Trigger.dev keys to .env.local." };
    // A "doing" task may just be busy — only restart it if its run has really stopped.
    if (await releaseStaleRuns(createAdminClient(), task.id)) return { ok: false, error: "It's still working on this — give it a moment." };
    const { error } = await supabase.from("tasks").update({ status: "backlog", result: null }).eq("id", taskId);
    if (error) return { ok: false, error: friendly(error.message) };
    if (!task.assignee_bot_id) return { ok: false, error: "Assign this task to a bot first." };
    await startTaskRun({ id: task.id, workspaceId: task.workspace_id, assigneeBotId: task.assignee_bot_id }, `retry-${Date.now()}`);
    return { ok: true };
  });
}

export async function deleteBot(workspaceId: string, botId: string): Promise<ActionResult> {
  return run(async () => {
    if (!uuid.safeParse(workspaceId).success || !uuid.safeParse(botId).success) return { ok: false, error: "Unknown bot." };
    const supabase = await client();
    // The Head bot is protected by a database trigger as well.
    const { error, count } = await supabase
      .from("bots")
      .delete({ count: "exact" })
      .eq("id", botId)
      .eq("workspace_id", workspaceId)
      .neq("role", "head");
    if (error) return { ok: false, error: friendly(error.message) };
    if (!count) return { ok: false, error: "The Head bot can't be deleted." };
    return { ok: true };
  });
}
