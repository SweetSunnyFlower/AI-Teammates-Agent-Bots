/**
 * Per-bot app access. `app_keys` holds Composio toolkit slugs, or "*" for every connected app
 * (dynamic: apps connected later are included). Safe to import on the client.
 */
export const ALL_APPS = "*";

/** Defaults for a new bot: the Head plans without apps; Leads and workers get every connected app. */
export const defaultAppKeys = (role: "head" | "lead" | "worker") => (role === "head" ? [] : [ALL_APPS]);

export const hasAllApps = (keys: readonly string[]) => keys.includes(ALL_APPS);
export const hasApp = (keys: readonly string[], slug: string) => hasAllApps(keys) || keys.includes(slug.toLowerCase());

/** What an access card shows ("Waiting on me", kind = access). Stored in inbox_items.preview. */
export interface AccessPreview {
  app: string;
  appName: string;
  /** Whether the workspace had the app connected when the bot asked. */
  connected: boolean;
  /** Other bots that already have this app (for "Hand it to …"). */
  holders: Array<{ id: string; name: string }>;
  /** What the bot needs it for (also the task title when chat work is handed over). */
  why: string;
}
