"use server";

import { z } from "zod";
import {
  answerQuestionCore,
  declineAppAccessCore,
  decideApprovalCore,
  grantAppAccessCore,
  handOffForAppCore,
  skipQuestionCore,
  type DecideContext,
} from "@/lib/inbox/decide";
import { createAdminClient } from "@/lib/db/admin";
import { hasDatabaseEnv } from "@/lib/db/env";
import { createClient } from "@/lib/db/server";

/**
 * Deciding "Waiting on me" items from the web. The user-scoped client may only read inbox items,
 * so ownership is checked first; the decision itself goes through the trusted runtime using the
 * shared implementation in lib/inbox/decide.ts (also used by Telegram and Slack).
 */

type Result = { ok: true } | { ok: false; error: string };

const uuid = z.string().uuid();

/** The item's workspace, if the signed-in user can see the item through their scoped client. */
async function webContext(itemId: string): Promise<DecideContext | { error: string }> {
  if (!hasDatabaseEnv || !uuid.safeParse(itemId).success) return { error: "事项不存在。" };
  const databaseClient = await createClient();
  const { data: item } = await databaseClient.from("inbox_items").select("workspace_id").eq("id", itemId).maybeSingle();
  if (!item) return { error: "事项不存在，或者你没有访问权限。" };
  return { db: createAdminClient(), workspaceId: item.workspace_id, via: "web" };
}

async function withItem(itemId: string, fn: (ctx: DecideContext) => Promise<{ ok: true } | { ok: false; error: string }>): Promise<Result> {
  const ctx = await webContext(itemId);
  if ("error" in ctx) return { ok: false, error: ctx.error };
  const res = await fn(ctx);
  return res.ok ? { ok: true } : { ok: false, error: res.error };
}

/** Approve (optionally with text edits to the arguments) or reject an action a bot wants to take. */
export async function decideApproval(
  itemId: string,
  decision: "approve" | "reject",
  options: { edits?: Array<Record<string, string>>; note?: string } = {},
): Promise<Result> {
  return withItem(itemId, (ctx) => decideApprovalCore(ctx, itemId, decision, options));
}

/** Answer a bot's question; the paused run continues with the answer. */
export async function answerQuestion(itemId: string, answer: string): Promise<Result> {
  return withItem(itemId, (ctx) => answerQuestionCore(ctx, itemId, answer));
}

/** Skip a question: the bot continues on its own judgement. */
export async function skipQuestion(itemId: string): Promise<Result> {
  return withItem(itemId, (ctx) => skipQuestionCore(ctx, itemId));
}

/** Give the bot the app it asked for. */
export async function grantAppAccess(itemId: string): Promise<Result> {
  return withItem(itemId, (ctx) => grantAppAccessCore(ctx, itemId));
}

/** Hand the work to a bot that already has the app. */
export async function handOffForApp(itemId: string, botId: string): Promise<Result> {
  return withItem(itemId, (ctx) => handOffForAppCore(ctx, itemId, botId));
}

/** Say no: the bot carries on without the app. */
export async function declineAppAccess(itemId: string): Promise<Result> {
  return withItem(itemId, (ctx) => declineAppAccessCore(ctx, itemId));
}
