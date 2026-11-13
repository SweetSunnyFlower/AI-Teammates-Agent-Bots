import type { createAdminClient } from "@/lib/supabase/admin";

/**
 * Who may talk to Dotty from Telegram / Slack: a `connections` row links one Telegram account or
 * one Slack workspace (plus the Slack user who installed it) to one Dotty workspace.
 */
type Db = ReturnType<typeof createAdminClient>;
export type ChannelProvider = "telegram" | "slack";

export interface ChannelLink {
  workspaceId: string;
  provider: ChannelProvider;
  /** Telegram user id, or Slack team id. */
  externalId: string;
  meta: {
    /** Telegram: Chat SDK channel id of the private chat (where cards and reports go). */
    channel_id?: string;
    username?: string;
    /** Slack: the user who installed Dotty (the only one it listens to). */
    user_id?: string;
    /**
     * Slack: the thread of the last conversation — a channel thread when Dotty was mentioned in a
     * channel, otherwise the DM. Reports and cards go here, so an answer lands where it was asked.
     */
    thread_id?: string;
    team_name?: string;
  };
}

type Row = { workspace_id: string; provider: ChannelProvider; external_id: string; meta: ChannelLink["meta"] | null };
const toLink = (r: Row): ChannelLink => ({ workspaceId: r.workspace_id, provider: r.provider, externalId: r.external_id, meta: r.meta ?? {} });

/** The link for an incoming Telegram user or Slack (team, user); null if they aren't linked. */
export async function findLink(db: Db, provider: ChannelProvider, userId: string, teamId?: string): Promise<ChannelLink | null> {
  const externalId = provider === "telegram" ? userId : teamId;
  if (!externalId) return null;
  const { data } = await db
    .from("connections")
    .select("workspace_id, provider, external_id, meta")
    .eq("provider", provider)
    .eq("external_id", externalId)
    .eq("status", "active")
    .maybeSingle<Row>();
  if (!data) return null;
  const link = toLink(data);
  if (provider === "slack" && link.meta.user_id !== userId) return null; // only the installer
  return link;
}

/** Remember the Slack thread the user is talking in, so pushes go back to the same place. */
export async function rememberThread(db: Db, link: ChannelLink, threadId: string) {
  if (link.meta.thread_id === threadId) return;
  await db
    .from("connections")
    .update({ meta: { ...link.meta, thread_id: threadId } })
    .eq("provider", link.provider)
    .eq("external_id", link.externalId);
}

export async function linksForWorkspace(db: Db, workspaceId: string, only?: ChannelProvider): Promise<ChannelLink[]> {
  const { data } = await db
    .from("connections")
    .select("workspace_id, provider, external_id, meta")
    .eq("workspace_id", workspaceId)
    .eq("status", "active")
    .in("provider", only ? [only] : ["telegram", "slack"]);
  return ((data ?? []) as Row[]).filter((r) => r.external_id).map(toLink);
}

/**
 * Link a Telegram account / Slack workspace to a Dotty workspace, replacing any earlier link of
 * the same account (one account talks to one workspace) and of the same workspace.
 */
export async function saveLink(db: Db, link: ChannelLink) {
  await db.from("connections").delete().eq("provider", link.provider).eq("external_id", link.externalId);
  await db.from("connections").delete().eq("provider", link.provider).eq("workspace_id", link.workspaceId);
  const { error } = await db.from("connections").insert({
    workspace_id: link.workspaceId,
    provider: link.provider,
    external_id: link.externalId,
    meta: link.meta,
    status: "active",
  });
  if (error) throw new Error(error.message);
}
