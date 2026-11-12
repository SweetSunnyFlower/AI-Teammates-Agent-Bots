import { wait } from "@trigger.dev/sdk";
import { z } from "zod";
import { applyEdits } from "@/lib/approvals/describe";
import { hasApp, type AccessPreview } from "@/lib/integrations/app-access";
import { connectedToolkits, hasComposio } from "@/lib/integrations/composio";
import { hasTrigger, startTaskRun } from "@/lib/runs/start";
import type { RoutineProposalInput } from "@/lib/routines/propose";
import { createRoutine } from "@/lib/routines/store";
import type { createAdminClient } from "@/lib/supabase/admin";

/**
 * Deciding "Waiting on me" items — the one implementation behind the web buttons and the Telegram
 * / Slack buttons. SERVER ONLY. Callers must have verified that the person deciding owns
 * `workspaceId` (web: the user's session through RLS; chat: the linked Telegram / Slack account);
 * everything here uses the service role and is scoped to that workspace.
 *
 * A decision is written only from `pending`, then the paused run is woken through its Trigger.dev
 * waitpoint. The run re-reads the row, so the database decision is what counts.
 */

type Db = ReturnType<typeof createAdminClient>;
export type Via = "web" | "telegram" | "slack";
export type DecideResult = { ok: true; message?: string } | { ok: false; error: string };
export interface DecideContext {
  db: Db;
  workspaceId: string;
  via: Via;
}

const uuid = z.string().uuid();
const EXPIRY_MS = 72 * 60 * 60 * 1000;
const editsSchema = z.array(z.record(z.string(), z.string().max(20000))).max(20);
const REOPEN = { status: "pending", edited_payload: null, answer: null, decided_via: null, decided_at: null };

type Kind = "approval" | "question" | "access";

export async function pendingItem(ctx: DecideContext, itemId: string, kind: Kind) {
  if (!uuid.safeParse(itemId).success) return { error: "Unknown item." } as const;
  const { data: item } = await ctx.db
    .from("inbox_items")
    .select("id, workspace_id, bot_id, task_id, kind, action, status, title, input, preview, tool_key, waitpoint_token_id, created_at")
    .eq("id", itemId)
    .eq("workspace_id", ctx.workspaceId)
    .maybeSingle();
  if (!item) return { error: "That item doesn't exist or isn't yours." } as const;
  if (item.kind !== kind) return { error: `That item is a ${item.kind}, not a ${kind}.` } as const;
  if (item.status !== "pending") return { error: `That was already ${item.status}.` } as const;
  if (Date.now() - new Date(item.created_at).getTime() > EXPIRY_MS) return { error: "This expired — the bot moved on without it." } as const;
  return { item } as const;
}

/** Write the decision (only if still pending), then wake the run. Undo the write if waking fails. */
async function decide(ctx: DecideContext, itemId: string, tokenId: string | null, update: Record<string, unknown>): Promise<DecideResult> {
  const { data: updated, error } = await ctx.db
    .from("inbox_items")
    .update({ ...update, decided_via: ctx.via, decided_at: new Date().toISOString() })
    .eq("id", itemId)
    .eq("workspace_id", ctx.workspaceId)
    .eq("status", "pending")
    .select("id");
  if (error) return { ok: false, error: friendly(error.message) };
  if (!updated?.length) return { ok: false, error: "That was already decided." };

  if (tokenId && hasTrigger()) {
    try {
      await wait.completeToken(tokenId, { status: update.status });
    } catch (e) {
      await ctx.db.from("inbox_items").update(REOPEN).eq("id", itemId);
      return { ok: false, error: `Couldn't wake the bot: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300) };
    }
  }
  return { ok: true };
}

const reopen = (ctx: DecideContext, itemId: string) => ctx.db.from("inbox_items").update(REOPEN).eq("id", itemId);

/** Approve (optionally with text edits to the arguments) or reject an action a bot wants to take. */
export async function decideApprovalCore(
  ctx: DecideContext,
  itemId: string,
  decision: "approve" | "reject",
  options: { edits?: Array<Record<string, string>>; note?: string } = {},
): Promise<DecideResult> {
  const found = await pendingItem(ctx, itemId, "approval");
  if ("error" in found) return { ok: false, error: found.error! };
  const { item } = found;

  if (decision === "reject") {
    const note = options.note?.trim().slice(0, 4000) || null;
    return decide(ctx, item.id, item.waitpoint_token_id, { status: "rejected", answer: note });
  }

  let edited: Record<string, unknown> | null = null;
  if (options.edits?.length) {
    const edits = editsSchema.safeParse(options.edits);
    if (!edits.success) return { ok: false, error: "Those edits aren't valid." };
    const input = (item.input ?? {}) as Record<string, unknown>;
    const next = applyEdits(input, edits.data);
    if (JSON.stringify(next) !== JSON.stringify(input)) edited = next;
  }
  if (item.action === "create_routine") return approveRoutine(ctx, item, (edited ?? item.input) as RoutineProposalInput, edited);
  return decide(ctx, item.id, item.waitpoint_token_id, { status: "approved", edited_payload: edited });
}

/**
 * Approving the Head's routine proposal creates the routine (with the user's edits). The item is
 * claimed first so a double click can't create two; if the routine can't be saved, it goes back
 * to pending with the reason.
 */
async function approveRoutine(
  ctx: DecideContext,
  item: { id: string; waitpoint_token_id: string | null },
  proposal: RoutineProposalInput,
  edited: Record<string, unknown> | null,
): Promise<DecideResult> {
  const { data: bot } = await ctx.db
    .from("bots")
    .select("id")
    .eq("workspace_id", ctx.workspaceId)
    .ilike("name", String(proposal.bot ?? "").replace(/[%_\\]/g, "\\$&"))
    .limit(1)
    .maybeSingle();
  if (!bot) return { ok: false, error: `There's no bot named “${proposal.bot}” — edit the bot name.` };

  const claimed = await decide(ctx, item.id, item.waitpoint_token_id, { status: "approved", edited_payload: edited });
  if (!claimed.ok) return claimed;
  const saved = await createRoutine(ctx.db, ctx.workspaceId, {
    name: String(proposal.name ?? ""),
    botId: bot.id,
    cron: String(proposal.cron ?? ""),
    timezone: String(proposal.timezone ?? "UTC"),
    prompt: String(proposal.prompt ?? ""),
    enabled: true,
  });
  if (!saved.ok) {
    await reopen(ctx, item.id);
    const detail = saved.fieldErrors ? Object.values(saved.fieldErrors).join(" ") : saved.error;
    return { ok: false, error: `Couldn't create the routine: ${detail}` };
  }
  return { ok: true, message: `Routine “${proposal.name}” created.` };
}

/** Answer a bot's question; the paused run continues with the answer. */
export async function answerQuestionCore(ctx: DecideContext, itemId: string, answer: string): Promise<DecideResult> {
  const text = answer.trim();
  if (!text || text.length > 4000) return { ok: false, error: "Write an answer (up to 4,000 characters)." };
  const found = await pendingItem(ctx, itemId, "question");
  if ("error" in found) return { ok: false, error: found.error! };
  return decide(ctx, found.item.id, found.item.waitpoint_token_id, { status: "answered", answer: text });
}

/** Skip a question: the bot continues on its own judgement. */
export async function skipQuestionCore(ctx: DecideContext, itemId: string): Promise<DecideResult> {
  const found = await pendingItem(ctx, itemId, "question");
  if ("error" in found) return { ok: false, error: found.error! };
  return decide(ctx, found.item.id, found.item.waitpoint_token_id, { status: "rejected" });
}

// ─── App access ("<bot> needs <app>") ───────────────────────────────────────────────────────────
// Only these change which apps a bot can use; the bot itself can only ask.

/** Give the bot the app it asked for. The app must be connected to the workspace by now. */
export async function grantAppAccessCore(ctx: DecideContext, itemId: string): Promise<DecideResult> {
  const found = await pendingItem(ctx, itemId, "access");
  if ("error" in found) return { ok: false, error: found.error! };
  const { item } = found;
  const preview = item.preview as AccessPreview;
  const slug = String(item.tool_key ?? preview.app ?? "");
  if (!item.bot_id) return { ok: false, error: "That bot no longer exists." };
  if (!hasComposio()) return { ok: false, error: "Composio isn't set up yet — add COMPOSIO_API_KEY to .env.local." };

  let connected = false;
  try {
    connected = (await connectedToolkits(ctx.workspaceId)).some((a) => a.slug === slug);
  } catch {
    return { ok: false, error: "Couldn't reach Composio — try again." };
  }
  if (!connected) return { ok: false, error: `Connect ${preview.appName} first, then give access.` };

  const { data: bot } = await ctx.db.from("bots").select("id, name, app_keys").eq("id", item.bot_id).eq("workspace_id", ctx.workspaceId).maybeSingle();
  if (!bot) return { ok: false, error: "That bot no longer exists." };
  const keys = (bot.app_keys ?? []) as string[];
  if (!hasApp(keys, slug)) {
    const { error } = await ctx.db.from("bots").update({ app_keys: [...keys, slug] }).eq("id", bot.id);
    if (error) return { ok: false, error: friendly(error.message) };
  }
  const done = await decide(ctx, item.id, item.waitpoint_token_id, { status: "approved" });
  return done.ok ? { ok: true, message: `${bot.name} can use ${preview.appName} now.` } : done;
}

/**
 * Hand the work to a bot that already has the app. A paused background run passes its task over
 * itself; a request from chat becomes a new task for that bot.
 */
export async function handOffForAppCore(ctx: DecideContext, itemId: string, botId: string): Promise<DecideResult> {
  if (!uuid.safeParse(botId).success) return { ok: false, error: "Pick a bot." };
  const found = await pendingItem(ctx, itemId, "access");
  if ("error" in found) return { ok: false, error: found.error! };
  const { item } = found;
  const preview = item.preview as AccessPreview;
  const slug = String(item.tool_key ?? preview.app ?? "");

  const { data: target } = await ctx.db
    .from("bots")
    .select("id, name, app_keys")
    .eq("id", botId)
    .eq("workspace_id", ctx.workspaceId)
    .maybeSingle();
  if (!target || target.id === item.bot_id) return { ok: false, error: "Pick another bot in this workspace." };
  if (!hasApp((target.app_keys ?? []) as string[], slug)) return { ok: false, error: `${target.name} can't use ${preview.appName} either.` };

  const handoff = { botId: target.id, botName: target.name };
  const message = `Handed to ${target.name}.`;
  if (item.waitpoint_token_id) {
    const done = await decide(ctx, item.id, item.waitpoint_token_id, { status: "answered", edited_payload: { handoff } });
    return done.ok ? { ok: true, message } : done;
  }

  // From chat: claim the item first (so a double click can't create two tasks), then add the task.
  const claimed = await decide(ctx, item.id, null, { status: "answered", edited_payload: { handoff } });
  if (!claimed.ok) return claimed;
  const { data: requester } = item.bot_id ? await ctx.db.from("bots").select("name").eq("id", item.bot_id).maybeSingle() : { data: null };
  const { data: task, error } = await ctx.db
    .from("tasks")
    .insert({
      workspace_id: ctx.workspaceId,
      title: preview.why.trim().slice(0, 200) || `Use ${preview.appName}`,
      body: `${requester?.name ?? "A bot"} needed ${preview.appName} for this and you handed it to ${target.name}.`,
      status: "backlog",
      assignee_bot_id: target.id,
      created_by_bot_id: item.bot_id,
      source: ctx.via,
    })
    .select("id")
    .single();
  if (error || !task) {
    await reopen(ctx, item.id);
    return { ok: false, error: friendly(error?.message ?? "Couldn't create the task.") };
  }
  try {
    await startTaskRun({ id: task.id, workspaceId: ctx.workspaceId, assigneeBotId: target.id });
  } catch {
    // The task is on the board; Retry (or the safety sweep) starts it.
  }
  return { ok: true, message };
}

/** Say no: the bot carries on without the app. */
export async function declineAppAccessCore(ctx: DecideContext, itemId: string): Promise<DecideResult> {
  const found = await pendingItem(ctx, itemId, "access");
  if ("error" in found) return { ok: false, error: found.error! };
  return decide(ctx, found.item.id, found.item.waitpoint_token_id, { status: "rejected" });
}

function friendly(message: string) {
  if (/fetch failed|ENOTFOUND|EAI_AGAIN|ECONN/i.test(message)) return "Couldn't reach Supabase — check your connection and try again.";
  return message;
}
