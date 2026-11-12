import type { SupabaseClient } from "@supabase/supabase-js";
import type { ApprovalPreview } from "@/lib/approvals/describe";
import { routineSchema } from "./schema";
import { describeCron, nextRunAt } from "./schedule";
import { notifyInboxItem } from "@/lib/chat/notify";

/**
 * The Head's `propose_routine`: checks the proposal and puts it on Waiting on me as an approval.
 * Nothing is scheduled here — the routine is created only when the user approves the card
 * (`decideApproval` in inbox-actions). Uses a service-role client (users can't write inbox items);
 * callers have already checked the bot belongs to the user.
 */
export interface RoutineProposal {
  name: string;
  bot: string;
  cron: string;
  timezone?: string;
  prompt: string;
}

/** The stored approval input — every field is text, so the user can edit any of it before approving. */
export interface RoutineProposalInput {
  name: string;
  bot: string;
  cron: string;
  timezone: string;
  prompt: string;
}

export async function proposeRoutine(
  db: SupabaseClient,
  ctx: {
    workspaceId: string;
    proposerId: string;
    roster: Array<{ id: string; name: string }>;
    defaultTimezone: string;
    taskId?: string;
    runId?: string;
  },
  p: RoutineProposal,
) {
  const target = ctx.roster.find((b) => b.name.toLowerCase() === p.bot.trim().toLowerCase());
  if (!target) return { ok: false, error: `No bot named "${p.bot}". Bots: ${ctx.roster.map((b) => b.name).join(", ")}` };

  const timezone = p.timezone?.trim() || ctx.defaultTimezone;
  const cron = p.cron.trim().replace(/\s+/g, " ");
  const parsed = routineSchema.safeParse({ name: p.name, botId: target.id, cron, timezone, prompt: p.prompt, enabled: true });
  if (!parsed.success) return { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") };
  if (!nextRunAt(cron, timezone)) return { ok: false, error: "That schedule never runs." };

  const input: RoutineProposalInput = { name: parsed.data.name, bot: target.name, cron, timezone, prompt: parsed.data.prompt };
  const preview: ApprovalPreview = {
    text: `${target.name} · ${describeCron(cron)} (${timezone})`,
    calls: [{ tool: "propose_routine", app: "Dotty", label: "add a routine", args: { ...input } }],
  };
  const { data: item, error } = await db.from("inbox_items").insert({
    workspace_id: ctx.workspaceId,
    bot_id: ctx.proposerId,
    task_id: ctx.taskId ?? null,
    run_id: ctx.runId ?? null,
    kind: "approval",
    action: "create_routine",
    tool_key: "propose_routine",
    title: `New routine: ${input.name}`.slice(0, 200),
    preview,
    input,
  }).select("id").single();
  if (error || !item) return { ok: false, error: "Couldn't put the proposal on Waiting on me right now." };
  await notifyInboxItem(item.id);
  return {
    ok: true,
    proposed: input.name,
    schedule: preview.text,
    note: "The proposal is on Waiting on me. The routine only exists once the user approves it there (they can edit it first) — tell them, and don't say it's set up yet.",
  };
}
