import { logger } from "@/lib/jobs/logger";
import { task } from "@/lib/jobs/runtime";
import { wait } from "@/lib/jobs/wait";
import { generateText, isStepCount, tool, type ModelMessage, type StepResult, type ToolSet } from "ai";
import { z } from "zod";
import { round4, stepCostCents } from "@/lib/ai/cost";
import { deepSeekModelFor } from "@/lib/ai/models";
import { buildChatTools, buildRunInstructions, canCode, loadChatContext } from "@/lib/chat/bot-context";
import { hasBox } from "@/lib/code/sandbox";
import { releaseStaleRuns } from "@/lib/runs/recover";
import { appToolsFor, planAccessRequest } from "@/lib/integrations/composio";
import { describeAppTool, isAppTool } from "@/lib/integrations/tool-labels";
import { createAdminClient } from "@/lib/db/admin";
import { proposeRoutine } from "@/lib/routines/propose";
import { notifyWorkspace } from "@/lib/chat/notify";
import { createHash } from "node:crypto";
import { askUser, requestAppAccess, waitForApproval, type PauseContext } from "./approvals";
import { engineeringRun } from "./engineering-run";

/**
 * A bot works one task in the background.
 *
 *   backlog → doing (bot "working") → done | failed (bot back to "resting" / "error")
 *
 * Every step is logged to `activity` and every status change is a row update, so the office,
 * board and chat update live through Supabase Realtime. Uses the service role: every query is
 * explicitly scoped to the task's workspace.
 */

type Payload = { taskId: string };

const MAX_STEPS = 15;
/** How many times one run may get new app access and carry on. */
const MAX_ACCESS_ROUNDS = 2;

export const botRun = task({
  id: "bot-run",
  // concurrencyKey = the assigned bot: each bot works one task at a time, different bots work in
  // parallel (up to `total` across the app).
  concurrency: { perKey: 1, total: 20 },
  maxDuration: 3600,
  retry: { maxAttempts: 2 },
  run: async ({ taskId }: Payload, { ctx }) => {
    const db = createAdminClient();

    const { data: t } = await db
      .from("tasks")
      .select("id, workspace_id, title, body, status, depth, assignee_bot_id, created_by_bot_id, parent_task_id, source")
      .eq("id", taskId)
      .maybeSingle();
    if (!t) return { skipped: "task not found" };
    if (!["backlog", "doing", "failed"].includes(t.status)) return { skipped: `task is ${t.status}` };

    // Release run rows left behind by a crashed worker; bail if another run is genuinely active.
    const alive = await releaseStaleRuns(db, t.id, ctx.run.id);
    if (alive && alive !== ctx.run.id) return { skipped: "另一个运行正在处理这个任务" };
    if (!t.assignee_bot_id) return finishFailed(db, t, null, null, "这个任务还没有分配 Bot。");

    // Like a small team: up to MAX_PARALLEL_PER_WORKSPACE bots work at once; the rest queue here.
    await waitForFreeDesk(db, t.workspace_id, t.assignee_bot_id, ctx.run.id);

    const chat = await loadChatContext(db, t.assignee_bot_id);
    if (!chat || chat.bot.workspace_id !== t.workspace_id) return finishFailed(db, t, null, null, "负责这个任务的 Bot 已不存在。");
    const { bot } = chat;

    // Spend cap: refuse to start once today's estimated spend reaches the workspace cap.
    const capCents = await dailyCapCents(db, t.workspace_id);
    let spentCents = await spentTodayCents(db, t.workspace_id);
    if (spentCents >= capCents) {
      return finishFailed(db, t, bot.id, null, `今日费用上限（$${(capCents / 100).toFixed(2)}）已达到，请在设置中提高上限或明天再试。`, "resting");
    }

    // Claim the task (the unique index allows one active run per task). A retry attempt of the
    // same Trigger run reuses its row.
    let run: { id: string } | null = null;
    if (alive === ctx.run.id) {
      const { data } = await db.from("runs").select("id").eq("task_id", t.id).eq("job_id", ctx.run.id).maybeSingle();
      run = data;
    }
    if (!run) {
      const { data, error: runError } = await db
        .from("runs")
        .insert({
          workspace_id: t.workspace_id,
          task_id: t.id,
          bot_id: bot.id,
          job_id: ctx.run.id,
          status: "running",
          started_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (runError || !data) {
        logger.warn("Task already has an active run", { taskId, error: runError?.message });
        return { skipped: "already running" };
      }
      run = data;
    }
    if (!run) return { skipped: "run could not be claimed" };
    const runId = run.id;

    await Promise.all([
      db.from("tasks").update({ status: "doing" }).eq("id", t.id),
      db.from("bots").update({ status: "working", status_detail: `正在处理“${t.title}”`, last_active_at: new Date().toISOString() }).eq("id", bot.id),
      logActivity(db, t.workspace_id, bot.id, t.id, "run_started", `开始处理“${t.title}”`),
    ]);

    const [{ data: owner }, createdBy] = await Promise.all([
      db.from("workspaces").select("owner_id").eq("id", t.workspace_id).single(),
      t.created_by_bot_id ? db.from("bots").select("name").eq("id", t.created_by_bot_id).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    const { data: profile } = await db.from("profiles").select("timezone").eq("user_id", owner?.owner_id ?? "").maybeSingle();

    const model = deepSeekModelFor(bot.model);
    const abort = new AbortController();
    let steps = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let runCents = 0;

    // The bot's own apps (chosen per bot). Gated app actions pause the run on Waiting on me until
    // you approve, edit or reject them.
    const pause: PauseContext = { db, workspaceId: t.workspace_id, botId: bot.id, taskId: t.id, taskTitle: t.title, runId };
    const loadApps = () => appToolsFor(t.workspace_id, bot.app_keys, { onApproval: (request) => waitForApproval(pause, request) });
    let appTools = await loadApps();
    // Set by request_app_access once the user decides (the run stops its current loop to act on it).
    const access: { grants: number; handoff: { botId: string; botName: string } | null } = { grants: 0, handoff: null };
    const askTool = {
      ask_user: tool({
        description:
          "向用户提问并等待答复（会显示在“待我处理”）。只有确实无法继续时才使用，例如缺少关键信息或必须由用户做决定。",
        inputSchema: z.object({
          question: z.string().min(3).max(200).describe("一句简短、具体的问题"),
          context: z.string().max(1000).optional().describe("提问原因或可选方案"),
        }),
        execute: ({ question, context }) => askUser(pause, question, context),
      }),
    };
    // Trigger.dev can't wait on two child runs at once, so code runs from one step go one by one.
    let codeQueue: Promise<unknown> = Promise.resolve();
    const tools = buildChatTools(db, chat, {
      parentTask: { id: t.id, depth: t.depth, source: t.source },
      // Delegated tasks start straight away, queued per workspace.
      onTaskCreated: async (child) => {
        await botRun.trigger(
          { taskId: child.id },
          { concurrencyKey: child.assigneeBotId, idempotencyKey: `task-${child.id}`, tags: [`workspace:${child.workspaceId}`, `task:${child.id}`] },
        );
      },
      // Routine proposals don't pause the run: the card waits on Waiting on me; approving creates it.
      onProposeRoutine: (proposal) =>
        proposeRoutine(
          db,
          { workspaceId: t.workspace_id, proposerId: bot.id, roster: chat.roster.bots, defaultTimezone: profile?.timezone ?? "UTC", taskId: t.id, runId },
          proposal,
        ),
      onApproval: (request) => waitForApproval(pause, request),
      // Engineering bots with GitHub: a code run in a sandbox (waits for it; one at a time).
      onCodeTask:
        canCode(chat) && hasBox() && appTools.apps.includes("GitHub")
          ? (request) => {
              const next = codeQueue.then(() => startCodeRun(t, bot.id, request));
              codeQueue = next.catch(() => undefined);
              return next;
            }
          : undefined,
      // A missing app: ask on Waiting on me and wait. Only the user's answer changes anything.
      onAppAccess: async ({ app, why }) => {
        const plan = await planAccessRequest({ workspaceId: t.workspace_id, bot, roster: chat.roster.bots, connected: appTools.connected, app, why });
        if (!plan.ok) return { ok: false, error: plan.message };
        const decision = await requestAppAccess(pause, plan.title, plan.preview);
        if ("granted" in decision) {
          access.grants += 1;
          return { ok: true, granted: true, note: `你现在已获得 ${plan.preview.appName} 权限，应用工具正在刷新。` };
        }
        if ("handoff" in decision) {
          access.handoff = decision.handoff;
          return { ok: true, handedOff: decision.handoff.botName, note: `用户已将任务交给 ${decision.handoff.botName}，你现在停止。` };
        }
        return { ok: false, granted: false, note: decision.note };
      },
    });

    try {
      let messages: ModelMessage[] = [{ role: "user", content: `开始处理：${t.title}` }];
      let finalText = "";
      for (let round = 0; ; round++) {
        const grantsBefore = access.grants;
        const result = await generateText({
          model,
          instructions: buildRunInstructions(chat, profile?.timezone ?? "UTC", {
            title: t.title,
            body: t.body,
            depth: t.depth,
            createdBy: createdBy.data?.name ?? (t.source === "routine" ? "你的例行任务（按计划自动运行）" : null),
          }, { mine: appTools.apps, connected: appTools.connected }),
          messages,
          tools: { ...appTools.tools, ...tools, ...askTool },
          // Stop the loop as soon as the user gives access (to reload the app tools) or hands the task over.
          stopWhen: [isStepCount(Math.max(1, MAX_STEPS - steps)), () => access.grants > grantsBefore || access.handoff !== null],
          abortSignal: abort.signal,
          onStepEnd: async (step) => {
            steps += 1;
            inputTokens += step.usage.inputTokens ?? 0;
            outputTokens += step.usage.outputTokens ?? 0;
            const cents = stepCostCents(step, bot.model);
            runCents += cents;
            spentCents += cents;

            await Promise.all([
              db.from("runs").update({ steps, input_tokens: inputTokens, output_tokens: outputTokens, cost_cents: round4(runCents) }).eq("id", runId),
              ...describeTools(step).filter((x): x is string => Boolean(x)).map((summary) => logActivity(db, t.workspace_id, bot.id, t.id, "tool", summary)),
            ]);

            if (spentCents >= capCents) {
              await logActivity(db, t.workspace_id, bot.id, t.id, "spend_cap", "已停止：今日费用上限已达到");
              abort.abort();
            }
          },
        });
        finalText = result.text;
        if (access.handoff || access.grants === grantsBefore || round >= MAX_ACCESS_ROUNDS || steps >= MAX_STEPS) break;
        // Access was granted: reload this bot's apps and carry on where it left off.
        const { data: fresh } = await db.from("bots").select("app_keys").eq("id", bot.id).maybeSingle();
        if (fresh) bot.app_keys = fresh.app_keys ?? [];
        appTools = await loadApps();
        messages = [...messages, ...result.response.messages, { role: "user", content: "权限已授予，应用工具已刷新，请继续处理任务。" }];
      }

      if (access.handoff) return handOff(db, t, bot.id, runId, ctx.run.id, access.handoff);

      const report = finalText.trim() || "已完成。";
      await Promise.all([
        db.from("runs").update({ status: "completed", ended_at: new Date().toISOString() }).eq("id", runId),
        db.from("tasks").update({ status: "done", result: { summary: report } }).eq("id", t.id),
        db.from("bots").update({ status: "resting", status_detail: "休息中", last_active_at: new Date().toISOString() }).eq("id", bot.id),
        logActivity(db, t.workspace_id, bot.id, t.id, "run_finished", `完成“${t.title}”`),
        postToThread(db, t.workspace_id, bot.id, t.id, ctx.run.id, `**已完成：${t.title}**\n\n${report}`),
        relayToRequesters(db, t, bot.id, ctx.run.id, `**${bot.name} 已完成：${t.title}**\n\n${report}`),
        reportToChannel(t, `✅ **${bot.name} 已完成：${t.title}**\n\n${report}`),
      ]);
      return { status: "done", steps, costCents: round4(runCents) };
    } catch (error) {
      const message = abort.signal.aborted
        ? "已停止：今日费用上限已达到。"
        : error instanceof Error
          ? error.message
          : String(error);
      logger.error("bot-run failed", { taskId, message });
      await db.from("runs").update({ status: "failed", ended_at: new Date().toISOString(), error: message.slice(0, 2000) }).eq("id", runId);
      await finishFailed(db, t, bot.id, ctx.run.id, friendly(message), abort.signal.aborted ? "resting" : "error");
      // Spend-cap stops and permanent problems shouldn't be retried; network blips should.
      if (!abort.signal.aborted && /fetch failed|ECONN|ETIMEDOUT|EAI_AGAIN|5\d\d/.test(message)) throw error;
      return { status: "failed", error: message };
    }
  },
});

type Db = ReturnType<typeof createAdminClient>;

/** Start a code run for this task and wait for its result (the bot run is paused meanwhile). */
async function startCodeRun(
  t: { id: string; workspace_id: string },
  botId: string,
  request: { repo: string; instructions: string; issue?: number; pr?: number; baseBranch?: string },
) {
  const key = createHash("sha256")
    .update(JSON.stringify([t.id, request.repo, request.instructions, request.issue ?? null, request.pr ?? null, request.baseBranch ?? null]))
    .digest("hex")
    .slice(0, 40);
  const result = await engineeringRun.triggerAndWait(
    {
      workspaceId: t.workspace_id,
      botId,
      taskId: t.id,
      repo: request.repo,
      instructions: request.instructions,
      issueNumber: request.issue,
      prNumber: request.pr,
      baseBranch: request.baseBranch,
    },
    { idempotencyKey: `code-${key}`, tags: [`workspace:${t.workspace_id}`, `task:${t.id}`] },
  );
  if (!result.ok) return { ok: false, error: "代码运行崩溃了，可以重试。" };
  const out = result.output;
  if (!out.ok) return out;
  return {
    ...out,
    note:
      out.status === "no_changes"
        ? "没有任何文件变更，所以没有创建 Pull Request。请在报告中说明原因。"
        : `请在报告中给出 Pull Request 链接${out.tests === "failed" ? "，说明测试失败和关键错误" : ""}以及修改内容。合并前需要用户批准。`,
  };
}

/** How many bots in one workspace can work at the same time (each bot still does one task at a time). */
const MAX_PARALLEL_PER_WORKSPACE = 3;
const QUEUE_CHECK_SECONDS = 15;
const MAX_QUEUE_CHECKS = 240; // ~1 hour, then go ahead anyway

/**
 * Wait until fewer than MAX_PARALLEL_PER_WORKSPACE runs are working in this workspace. Runs paused
 * on Waiting on me ("waiting") don't count, and neither do rows older than the max run time (left
 * behind by a crash). A soft cap: two runs starting in the same instant may both get through.
 */
async function waitForFreeDesk(db: Db, workspaceId: string, botId: string, triggerRunId: string) {
  for (let check = 0; check < MAX_QUEUE_CHECKS; check++) {
    const { count } = await db
      .from("runs")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .eq("status", "running")
      .neq("job_id", triggerRunId)
      .gte("started_at", new Date(Date.now() - 65 * 60 * 1000).toISOString());
    if ((count ?? 0) < MAX_PARALLEL_PER_WORKSPACE) return;
    if (check === 0) {
      await db
        .from("bots")
        .update({ status_detail: `排队中：已有 ${MAX_PARALLEL_PER_WORKSPACE} 个 Bot 在工作` })
        .eq("id", botId)
        .eq("status", "resting");
    }
    await wait.for({ seconds: QUEUE_CHECK_SECONDS });
  }
}
type TaskRow = { id: string; workspace_id: string; title: string; created_by_bot_id: string | null; parent_task_id: string | null; source?: string };

/** Tasks sent from Telegram / Slack report back there too. */
function reportToChannel(t: TaskRow, markdown: string) {
  return t.source === "telegram" || t.source === "slack" ? notifyWorkspace(t.workspace_id, markdown, t.source) : Promise.resolve();
}

/**
 * "Hand it to <bot>" on an access card: this run stops and the same task starts over with a bot
 * that has the app (the user picked it; the inbox action checked it belongs to this workspace).
 */
async function handOff(db: Db, t: TaskRow, botId: string, runId: string, triggerRunId: string, target: { botId: string; botName: string }) {
  const { data: other } = await db.from("bots").select("id").eq("id", target.botId).eq("workspace_id", t.workspace_id).maybeSingle();
  if (!other) return finishFailed(db, t, botId, triggerRunId, `${target.botName} 已不存在，无法移交任务。`);
  const now = new Date().toISOString();
  await db.from("runs").update({ status: "completed", ended_at: now }).eq("id", runId);
  await Promise.all([
    db.from("tasks").update({ status: "backlog", assignee_bot_id: target.botId }).eq("id", t.id),
    db.from("bots").update({ status: "resting", status_detail: "休息中", last_active_at: now }).eq("id", botId),
    logActivity(db, t.workspace_id, botId, t.id, "handoff", `已将“${t.title}”交给 ${target.botName}`),
  ]);
  await botRun.trigger(
    { taskId: t.id },
    { concurrencyKey: target.botId, idempotencyKey: `task-${t.id}-to-${target.botId}-${runId}`, tags: [`workspace:${t.workspace_id}`, `task:${t.id}`] },
  );
  return { status: "handed_off", to: target.botName };
}

async function finishFailed(db: Db, t: TaskRow, botId: string | null, runId: string | null, reason: string, botStatus: "error" | "resting" = "error") {
  await Promise.all([
    db.from("tasks").update({ status: "failed", result: { error: reason } }).eq("id", t.id),
    botId
      ? db.from("bots").update({ status: botStatus, status_detail: botStatus === "error" ? `卡在“${t.title}”` : "休息中", last_active_at: new Date().toISOString() }).eq("id", botId)
      : Promise.resolve(),
    logActivity(db, t.workspace_id, botId, t.id, "run_failed", `未能完成“${t.title}”：${reason}`.slice(0, 480)),
    botId ? postToThread(db, t.workspace_id, botId, t.id, runId ?? `${Date.now()}`, `**未能完成：${t.title}**\n\n${reason}\n\n可以在任务看板中重试。`) : Promise.resolve(),
    botId ? relayToRequesters(db, t, botId, runId ?? `${Date.now()}`, `**未能完成：${t.title}**\n\n${reason}\n\n可以在任务看板中重试。`) : Promise.resolve(),
    reportToChannel(t, `⚠️ **未能完成：${t.title}**\n\n${reason}\n\n可以在任务看板中重试。`),
  ]);
  return { status: "failed", error: reason };
}

function logActivity(db: Db, workspaceId: string, botId: string | null, taskId: string, type: string, summary: string) {
  return db.from("activity").insert({ workspace_id: workspaceId, bot_id: botId, task_id: taskId, type, summary: summary.slice(0, 500) });
}

/** Run results land in the bot's chat thread (the thread updates live). */
function postToThread(db: Db, workspaceId: string, botId: string, taskId: string, runId: string, text: string) {
  return db.from("messages").insert({
    workspace_id: workspaceId,
    bot_id: botId,
    role: "assistant",
    parts: [{ type: "text", text }],
    channel: "web",
    // `task-<task id>-…` lets "Read reply" find the report for a task.
    ui_id: replyMessageId(taskId, runId),
  });
}

/**
 * Delegated work reports back up the chain: the bot that handed over the task (e.g. a Lead) and
 * everyone above it (e.g. the Head you were chatting with) get the result in their threads, so it
 * shows up where you asked — not only in the worker's own chat.
 */
async function relayToRequesters(db: Db, t: TaskRow, workerId: string, runId: string, text: string) {
  const requesters = new Set<string>();
  let current: { created_by_bot_id: string | null; parent_task_id: string | null } | null = t;
  for (let hops = 0; current && hops < 5; hops++) {
    if (current.created_by_bot_id && current.created_by_bot_id !== workerId) requesters.add(current.created_by_bot_id);
    if (!current.parent_task_id) break;
    const { data: parent }: { data: { created_by_bot_id: string | null; parent_task_id: string | null } | null } = await db
      .from("tasks")
      .select("created_by_bot_id, parent_task_id")
      .eq("id", current.parent_task_id)
      .maybeSingle();
    current = parent;
  }
  await Promise.all(
    // A distinct id per thread that still starts with `task-<id>`, so "Read reply" finds it.
    [...requesters].map((botId) => postToThread(db, t.workspace_id, botId, t.id, `${botId.slice(0, 4)}${runId.slice(-8)}`, text)),
  );
}

/** Message id of a task's report in the bot's thread (≤ 64 chars). */
export function replyMessageId(taskId: string, runId: string) {
  return `task-${taskId}-${runId.slice(-12)}`;
}

async function dailyCapCents(db: Db, workspaceId: string) {
  const { data } = await db.from("workspaces").select("daily_spend_cap_cents").eq("id", workspaceId).single();
  return data?.daily_spend_cap_cents ?? 500;
}

async function spentTodayCents(db: Db, workspaceId: string) {
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  const { data } = await db.from("runs").select("cost_cents").eq("workspace_id", workspaceId).gte("created_at", since.toISOString());
  return (data ?? []).reduce((sum: number, r: any) => sum + Number(r.cost_cents ?? 0), 0);
}

/** One activity line per tool the bot used in this step. */
function describeTools(step: StepResult<ToolSet>) {
  return step.toolResults.map((r) => {
    const out = (r.output ?? {}) as { ok?: boolean; title?: string; assignee?: string; error?: string };
    switch (r.toolName) {
      case "create_task":
        return out.ok ? `已将“${out.title}”交给 ${out.assignee}` : `创建任务失败：${out.error ?? "未知错误"}`;
      case "update_notes":
        return "更新了笔记";
      case "read_notes":
        return "读取了笔记";
      case "list_tasks":
        return "检查了任务看板";
      case "ask_user":
        return "向你提问";
      case "request_app_access":
        return null; // the Waiting on me card is logged already
      case "run_code_task": {
        const code = r.output as { ok?: boolean; prUrl?: string; prNumber?: number; status?: string; error?: string };
        if (!code.ok) return `代码运行失败：${code.error ?? "未知错误"}`;
        return code.prNumber ? `代码运行完成，Pull Request #${code.prNumber}` : "代码运行完成，没有文件变更";
      }
      case "propose_routine":
        return out.ok ? `提议了例行任务“${(r.output as { proposed?: string }).proposed ?? ""}”，等待你确认` : `提议例行任务失败：${out.error ?? "未知错误"}`;
      default:
        if (isAppTool(r.toolName)) {
          const info = describeAppTool(r.toolName, r.input);
          // Lookups ("found tools for …") are noise in the activity feed; keep real app actions.
          return info.lookup ? null : `使用了 ${info.done}`;
        }
        return `使用了 ${r.toolName}`;
    }
  });
}

function friendly(message: string) {
  if (/fetch failed|ENOTFOUND|EAI_AGAIN|ECONN/i.test(message)) return "无法连接 AI 服务，系统会自动重试。";
  if (/401|403|unauthorized|api key/i.test(message)) return "DeepSeek 拒绝了 API Key，请检查 DEEPSEEK_API_KEY。";
  return message.slice(0, 400);
}

