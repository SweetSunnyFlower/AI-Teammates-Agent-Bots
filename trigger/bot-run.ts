import { logger, task } from "@trigger.dev/sdk";
import { generateText, isStepCount, type StepResult, type ToolSet } from "ai";
import { gatewayModelFor } from "@/lib/ai/models";
import { buildChatTools, buildRunInstructions, loadChatContext } from "@/lib/chat/bot-context";
import { releaseStaleRuns } from "@/lib/runs/recover";
import { createAdminClient } from "@/lib/supabase/admin";

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

// Fallback price estimates (USD per 1M tokens) used only when AI Gateway doesn't report a cost.
// Verify against your AI Gateway dashboard and adjust.
const PRICE_PER_MTOK: Record<string, { input: number; output: number }> = {
  "anthropic/claude-sonnet-5.5": { input: 3, output: 15 },
  "anthropic/claude-haiku-5.5": { input: 1, output: 5 },
  "anthropic/claude-opus-5.5": { input: 5, output: 25 },
};

export const botRun = task({
  id: "bot-run",
  // One run at a time per workspace (concurrencyKey = workspace id), 10 across the app.
  concurrency: { perKey: 1, total: 10 },
  maxDuration: 3600,
  retry: { maxAttempts: 2 },
  run: async ({ taskId }: Payload, { ctx }) => {
    const db = createAdminClient();

    const { data: t } = await db
      .from("tasks")
      .select("id, workspace_id, title, body, status, depth, assignee_bot_id, created_by_bot_id")
      .eq("id", taskId)
      .maybeSingle();
    if (!t) return { skipped: "task not found" };
    if (!["backlog", "doing", "failed"].includes(t.status)) return { skipped: `task is ${t.status}` };

    // Release run rows left behind by a crashed worker; bail if another run is genuinely active.
    const alive = await releaseStaleRuns(db, t.id, ctx.run.id);
    if (alive && alive !== ctx.run.id) return { skipped: "another run is working on this task" };
    if (!t.assignee_bot_id) return finishFailed(db, t, null, null, "No bot is assigned to this task.");

    const chat = await loadChatContext(db, t.assignee_bot_id);
    if (!chat || chat.bot.workspace_id !== t.workspace_id) return finishFailed(db, t, null, null, "The assigned bot no longer exists.");
    const { bot } = chat;

    // Spend cap: refuse to start once today's estimated spend reaches the workspace cap.
    const capCents = await dailyCapCents(db, t.workspace_id);
    let spentCents = await spentTodayCents(db, t.workspace_id);
    if (spentCents >= capCents) {
      return finishFailed(db, t, bot.id, null, `Today's spend cap ($${(capCents / 100).toFixed(2)}) is reached — raise it in settings or try tomorrow.`, "resting");
    }

    // Claim the task (the unique index allows one active run per task). A retry attempt of the
    // same Trigger run reuses its row.
    let run: { id: string } | null = null;
    if (alive === ctx.run.id) {
      const { data } = await db.from("runs").select("id").eq("task_id", t.id).eq("trigger_run_id", ctx.run.id).maybeSingle();
      run = data;
    }
    if (!run) {
      const { data, error: runError } = await db
        .from("runs")
        .insert({
          workspace_id: t.workspace_id,
          task_id: t.id,
          bot_id: bot.id,
          trigger_run_id: ctx.run.id,
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
    const runId = run.id;

    await Promise.all([
      db.from("tasks").update({ status: "doing" }).eq("id", t.id),
      db.from("bots").update({ status: "working", status_detail: `Working on “${t.title}”`, last_active_at: new Date().toISOString() }).eq("id", bot.id),
      logActivity(db, t.workspace_id, bot.id, t.id, "run_started", `started “${t.title}”`),
    ]);

    const [{ data: owner }, createdBy] = await Promise.all([
      db.from("workspaces").select("owner_id").eq("id", t.workspace_id).single(),
      t.created_by_bot_id ? db.from("bots").select("name").eq("id", t.created_by_bot_id).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    const { data: profile } = await db.from("profiles").select("timezone").eq("user_id", owner?.owner_id ?? "").maybeSingle();

    const model = gatewayModelFor(bot.model);
    const abort = new AbortController();
    let steps = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let runCents = 0;

    const tools = buildChatTools(db, chat, {
      parentTask: { id: t.id, depth: t.depth },
      // Delegated tasks start straight away, queued per workspace.
      onTaskCreated: async (child) => {
        await botRun.trigger(
          { taskId: child.id },
          { concurrencyKey: child.workspaceId, idempotencyKey: `task-${child.id}`, tags: [`workspace:${child.workspaceId}`, `task:${child.id}`] },
        );
      },
    });

    try {
      const result = await generateText({
        model,
        instructions: buildRunInstructions(chat, profile?.timezone ?? "UTC", {
          title: t.title,
          body: t.body,
          depth: t.depth,
          createdBy: createdBy.data?.name ?? null,
        }),
        prompt: `Start working on: ${t.title}`,
        tools,
        stopWhen: isStepCount(MAX_STEPS),
        abortSignal: abort.signal,
        onStepEnd: async (step) => {
          steps += 1;
          inputTokens += step.usage.inputTokens ?? 0;
          outputTokens += step.usage.outputTokens ?? 0;
          const cents = stepCostCents(step, model);
          runCents += cents;
          spentCents += cents;

          await Promise.all([
            db.from("runs").update({ steps, input_tokens: inputTokens, output_tokens: outputTokens, cost_cents: round4(runCents) }).eq("id", runId),
            ...describeTools(step).map((summary) => logActivity(db, t.workspace_id, bot.id, t.id, "tool", summary)),
          ]);

          if (spentCents >= capCents) {
            await logActivity(db, t.workspace_id, bot.id, t.id, "spend_cap", "stopped — today's spend cap was reached");
            abort.abort();
          }
        },
      });

      const report = result.text.trim() || "Done.";
      await Promise.all([
        db.from("runs").update({ status: "completed", ended_at: new Date().toISOString() }).eq("id", runId),
        db.from("tasks").update({ status: "done", result: { summary: report } }).eq("id", t.id),
        db.from("bots").update({ status: "resting", status_detail: "Resting", last_active_at: new Date().toISOString() }).eq("id", bot.id),
        logActivity(db, t.workspace_id, bot.id, t.id, "run_finished", `finished “${t.title}”`),
        postToThread(db, t.workspace_id, bot.id, t.id, ctx.run.id, `**Finished: ${t.title}**\n\n${report}`),
      ]);
      return { status: "done", steps, costCents: round4(runCents) };
    } catch (error) {
      const message = abort.signal.aborted
        ? "Stopped: today's spend cap was reached."
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
type TaskRow = { id: string; workspace_id: string; title: string };

async function finishFailed(db: Db, t: TaskRow, botId: string | null, runId: string | null, reason: string, botStatus: "error" | "resting" = "error") {
  await Promise.all([
    db.from("tasks").update({ status: "failed", result: { error: reason } }).eq("id", t.id),
    botId
      ? db.from("bots").update({ status: botStatus, status_detail: botStatus === "error" ? `Stuck on “${t.title}”` : "Resting", last_active_at: new Date().toISOString() }).eq("id", botId)
      : Promise.resolve(),
    logActivity(db, t.workspace_id, botId, t.id, "run_failed", `couldn't finish “${t.title}”: ${reason}`.slice(0, 480)),
    botId ? postToThread(db, t.workspace_id, botId, t.id, runId ?? `${Date.now()}`, `**Couldn't finish: ${t.title}**\n\n${reason}\n\nYou can retry it from the board.`) : Promise.resolve(),
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
  return (data ?? []).reduce((sum, r) => sum + Number(r.cost_cents ?? 0), 0);
}

/** Cost of one step in cents: AI Gateway's reported cost when present, else a token estimate. */
function stepCostCents(step: StepResult<ToolSet>, model: string) {
  const gateway = step.providerMetadata?.gateway as { cost?: string | number } | undefined;
  const reported = gateway?.cost !== undefined ? Number(gateway.cost) : NaN;
  if (Number.isFinite(reported)) return reported * 100;
  const price = PRICE_PER_MTOK[model] ?? PRICE_PER_MTOK["anthropic/claude-sonnet-5.5"];
  return (((step.usage.inputTokens ?? 0) * price.input + (step.usage.outputTokens ?? 0) * price.output) / 1_000_000) * 100;
}

/** One activity line per tool the bot used in this step. */
function describeTools(step: StepResult<ToolSet>) {
  return step.toolResults.map((r) => {
    const out = (r.output ?? {}) as { ok?: boolean; title?: string; assignee?: string; error?: string };
    switch (r.toolName) {
      case "create_task":
        return out.ok ? `handed “${out.title}” to ${out.assignee}` : `couldn't create a task: ${out.error ?? "error"}`;
      case "update_notes":
        return "updated its notes";
      case "read_notes":
        return "read its notes";
      case "list_tasks":
        return "checked the board";
      default:
        return `used ${r.toolName}`;
    }
  });
}

function friendly(message: string) {
  if (/fetch failed|ENOTFOUND|EAI_AGAIN|ECONN/i.test(message)) return "Couldn't reach the AI service — it will be retried.";
  if (/401|403|unauthorized|api key/i.test(message)) return "The AI Gateway key was rejected — check AI_GATEWAY_API_KEY.";
  return message.slice(0, 400);
}

const round4 = (n: number) => Math.round(n * 10000) / 10000;
