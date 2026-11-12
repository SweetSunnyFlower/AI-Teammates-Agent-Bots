import { Composio, ComposioToolInputRequiredError } from "@composio/core";
import { VercelProvider } from "@composio/vercel";
import type { ToolSet } from "ai";
import { hasApp, type AccessPreview } from "./app-access";

/**
 * Composio Platform: each Dotty workspace is one Composio user (its "tenant"), so every bot in a
 * workspace shares the apps connected in Settings → Connectors. SERVER ONLY (uses COMPOSIO_API_KEY).
 */
export const hasComposio = () => Boolean(process.env.COMPOSIO_API_KEY);

let client: Composio<VercelProvider> | null = null;
export function composio() {
  // The SDK reads COMPOSIO_API_KEY from the environment.
  client ??= new Composio({ provider: new VercelProvider() });
  return client;
}

/** The Composio user id for a workspace. */
export const composioUserId = (workspaceId: string) => `workspace_${workspaceId}`;

/**
 * A session for showing/managing connections in our own UI: no in-chat connect prompts.
 */
export function connectionsSession(workspaceId: string) {
  return composio().create(composioUserId(workspaceId), { manageConnections: false });
}

type Hint = "createHint" | "updateHint" | "destructiveHint";

/**
 * The approval rule ("nothing sends, posts, publishes or deletes without you"): every tool tagged as
 * creating, updating or deleting needs the user's approval. Composio pauses such a call and asks;
 * our gate (below) turns that into a "Waiting on me" item. A few apps get a narrower rule because
 * their writes stay inside your own space (or their tags are wrong):
 */
const DEFAULT_GATED: Hint[] = ["createHint", "updateHint", "destructiveHint"];
const APP_POLICY: Record<string, Hint[]> = {
  // Every Tavily tool is a lookup; Composio tags TAVILY_SEARCH as createHint by mistake.
  tavily: [],
  // Writing pages/notes in your own Notion is fine; deleting/archiving needs approval.
  notion: ["destructiveHint"],
};

/** One app action the bot wants to take, as shown to the user. */
export interface GatedCall {
  tool: string;
  args: Record<string, unknown>;
}

/** What the gate asks the user to approve. `args` are the exact tool arguments. */
export interface ApprovalRequest {
  tool: string;
  args: Record<string, unknown>;
  calls: GatedCall[];
  /** Composio's own description of why approval is needed. */
  reasons: string[];
}

export type ApprovalDecision = { approved: true; args: Record<string, unknown> } | { approved: false; reason: string };
/** Decides a gated call. Background runs wait for the user; chat can't wait, so it declines. */
export type ApprovalHandler = (request: ApprovalRequest) => Promise<ApprovalDecision>;

let warnedMissingKey = false;

export interface ConnectedApp {
  slug: string;
  name: string;
  logo: string | null;
}

/** A bot's app tools plus what it needs to know about the apps it can't use. */
export interface BotApps {
  tools: ToolSet;
  /** Names of the apps this bot can use. */
  apps: string[];
  /** Every app connected to the workspace. */
  connected: ConnectedApp[];
}

/**
 * App tools for one bot: the workspace's connected toolkits, limited to the bot's own choice
 * (`appKeys`: slugs, or "*" for all). Gated calls go through `onApproval` (see APP_POLICY);
 * without one they are refused. The sandbox (workbench) is off because scripts there can bypass
 * the approval check. Returns no tools if Composio isn't set up or fails — bots keep working with
 * their built-in tools.
 */
export async function appToolsFor(
  workspaceId: string,
  appKeys: readonly string[],
  options: { onApproval?: ApprovalHandler } = {},
): Promise<BotApps> {
  if (!hasComposio()) {
    if (!warnedMissingKey) {
      warnedMissingKey = true;
      console.warn("[composio] COMPOSIO_API_KEY is not set in this process — bots get no app tools. Restart it after adding the key.");
    }
    return { tools: {}, apps: [], connected: [] };
  }
  let connected: ConnectedApp[] = [];
  try {
    connected = await connectedToolkits(workspaceId);
    const apps = connected.filter((a) => hasApp(appKeys, a.slug));
    if (!apps.length) return { tools: {}, apps: [], connected };
    // A per-toolkit `tags` replaces the session-wide one for that toolkit.
    const overrides = Object.fromEntries(
      apps.filter((a) => a.slug in APP_POLICY).map((a) => [a.slug, { tags: { requireApproval: APP_POLICY[a.slug] } }]),
    );
    const session = await composio().create(composioUserId(workspaceId), {
      toolkits: apps.map((a) => a.slug),
      tags: { requireApproval: DEFAULT_GATED },
      tools: overrides,
      manageConnections: false,
      workbench: { enable: false },
    });
    const tools = (await session.tools()) as ToolSet;
    return { tools: gateTools(tools, session, options.onApproval), apps: apps.map((a) => a.name), connected };
  } catch (error) {
    console.error("[composio] couldn't load app tools", error);
    return { tools: {}, apps: [], connected };
  }
}

type AppSession = Awaited<ReturnType<ReturnType<typeof composio>["create"]>>;

/**
 * The approval gate. A gated call makes Composio throw ComposioToolInputRequiredError — nothing has
 * run. We ask `onApproval`; if the user approves, we run ONLY the approved (possibly edited)
 * arguments and answer Composio's approval question for exactly that call.
 */
function gateTools(tools: ToolSet, session: AppSession, onApproval?: ApprovalHandler): ToolSet {
  const gated: ToolSet = {};
  for (const [slug, t] of Object.entries(tools)) {
    const original = t.execute;
    if (!original) {
      gated[slug] = t;
      continue;
    }
    gated[slug] = {
      ...t,
      execute: async (args: Record<string, unknown>, callOptions: Parameters<typeof original>[1]) => {
        try {
          return await original(args, callOptions);
        } catch (error) {
          if (!(error instanceof ComposioToolInputRequiredError)) throw error;
          const request: ApprovalRequest = {
            tool: slug,
            args,
            calls: callsOf(slug, args),
            reasons: Object.values(error.inputRequests).map((r) => r.message).filter(Boolean),
          };
          if (!onApproval) {
            return {
              successful: false,
              error:
                "This action needs the user's approval, which can only wait inside a background task. Create a task for yourself (create_task) with every detail needed (recipient, subject, full text…), and it will ask the user to approve it.",
            };
          }
          const decision = await onApproval(request);
          if (!decision.approved) return { successful: false, error: decision.reason };
          return runApproved(session, slug, decision.args);
        }
      },
    } as typeof t;
  }
  return gated;
}

/** Run an approved call; if Composio asks again, approve exactly this call (same args). */
async function runApproved(session: AppSession, slug: string, args: Record<string, unknown>) {
  const shape = (r: { data: unknown; error: string | null; resultType: string }) => ({
    successful: r.resultType === "completed",
    data: r.data,
    error: r.error,
  });
  try {
    return shape(await session.execute(slug, args));
  } catch (error) {
    if (!(error instanceof ComposioToolInputRequiredError)) throw error;
    const inputResponses = Object.fromEntries(
      Object.keys(error.inputRequests).map((id) => [id, { action: "accept" as const, content: { decision: "approve" } }]),
    );
    return shape(await session.execute(slug, args, { inputResponses, requestState: error.requestState }));
  }
}

/** The individual app actions in a call (COMPOSIO_MULTI_EXECUTE_TOOL batches several). */
export function callsOf(slug: string, args: Record<string, unknown>): GatedCall[] {
  const list = Array.isArray(args.tools) ? (args.tools as Array<Record<string, unknown>>) : null;
  if (list) {
    return list.map((c) => ({
      tool: String(c.tool_slug ?? c.slug ?? "app action"),
      args: (c.arguments && typeof c.arguments === "object" ? c.arguments : {}) as Record<string, unknown>,
    }));
  }
  return [{ tool: slug, args }];
}

/** Toolkits this workspace has an active connection to. */
export async function connectedToolkits(workspaceId: string) {
  const session = await connectionsSession(workspaceId);
  const found: ConnectedApp[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 10; page++) {
    const res = await session.toolkits({ isConnected: true, cursor, limit: 50 });
    for (const t of res.items) if (t.connection?.isActive) found.push({ slug: t.slug.toLowerCase(), name: t.name, logo: t.logo ?? null });
    cursor = res.cursor;
    if (!cursor) break;
  }
  return found;
}

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Work out an app-access request (the bot's `request_app_access` tool): which app it means, whether
 * the workspace has it connected, and which other bots already have it. Never changes access —
 * only the user grants it, from the Waiting on me card.
 */
export async function planAccessRequest(input: {
  workspaceId: string;
  bot: { id: string; app_keys: string[] };
  roster: Array<{ id: string; name: string; app_keys?: string[] }>;
  connected: ConnectedApp[];
  app: string;
  why: string;
}): Promise<{ ok: false; message: string } | { ok: true; title: string; preview: AccessPreview }> {
  const wanted = squash(input.app);
  if (!wanted) return { ok: false, message: "Say which app you need (e.g. Gmail, Notion, Slack)." };
  let app: { slug: string; name: string } | undefined = input.connected.find((a) => squash(a.slug) === wanted || squash(a.name) === wanted);
  const connected = Boolean(app);
  if (app && hasApp(input.bot.app_keys, app.slug)) {
    return { ok: false, message: `You already have ${app.name}. Use it through COMPOSIO_SEARCH_TOOLS.` };
  }
  if (!app && hasComposio()) {
    // Not connected: find it in the catalog so the card can offer "Connect <app>".
    try {
      const res = await (await connectionsSession(input.workspaceId)).toolkits({ search: input.app, limit: 5 });
      const hit = res.items.find((t) => squash(t.slug) === wanted || squash(t.name) === wanted) ?? res.items[0];
      if (hit && hit.slug.toLowerCase() !== "composio") app = { slug: hit.slug.toLowerCase(), name: hit.name };
    } catch {
      // Fall through with the name the bot used.
    }
  }
  const slug = app?.slug ?? input.app.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 64);
  const appName = app?.name ?? input.app.trim().slice(0, 60);
  const holders = connected
    ? input.roster.filter((b) => b.id !== input.bot.id && hasApp(b.app_keys ?? [], slug)).map((b) => ({ id: b.id, name: b.name }))
    : [];
  return {
    ok: true,
    title: `Needs ${appName}: ${input.why}`.slice(0, 200),
    preview: { app: slug, appName, connected, holders, why: input.why.slice(0, 1000) },
  };
}
