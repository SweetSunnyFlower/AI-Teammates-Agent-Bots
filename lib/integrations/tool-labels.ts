import { describeTool } from "@/lib/approvals/describe";

/**
 * Bots reach apps through Composio's generic meta tools (search, get schemas, multi-execute), so a
 * raw tool name like COMPOSIO_MULTI_EXECUTE_TOOL says nothing. The real app action is in the
 * input — this turns it back into "Gmail · fetch emails" plus the app's logo. Pure; client + server.
 */

export interface AppRef {
  /** Composio toolkit slug, e.g. "gmail". */
  slug: string;
  name: string;
  logo: string;
}

export interface AppToolLabel {
  /** What happened (done) — "Gmail · fetch emails". */
  done: string;
  /** While it runs — "Using Gmail · fetch emails…". */
  running: string;
  apps: AppRef[];
  /** A lookup step (finding / reading tools), not a real app action. */
  lookup: boolean;
}

export const isAppTool = (name: string) => name.startsWith("COMPOSIO_") || name.startsWith("GITHUB_");

/** Composio's logo CDN, by toolkit slug. */
export const appLogo = (slug: string) => `https://logos.composio.dev/api/${encodeURIComponent(slug)}`;

/** "GMAIL_SEND_EMAIL" → the Gmail toolkit. */
export function appOf(toolSlug: string): AppRef {
  const slug = (toolSlug.split("_")[0] ?? toolSlug).toLowerCase();
  return { slug, name: describeTool(toolSlug).app, logo: appLogo(slug) };
}

const uniqueApps = (slugs: string[]) => {
  const seen = new Map<string, AppRef>();
  for (const s of slugs) {
    const app = appOf(s);
    if (!seen.has(app.slug)) seen.set(app.slug, app);
  }
  return [...seen.values()];
};

const actions = (slugs: string[]) =>
  [...new Set(slugs.map((s) => `${describeTool(s).app} · ${describeTool(s).label}`))].join("，") || "应用";

export function describeAppTool(name: string, input: unknown): AppToolLabel {
  const args = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;

  if (name === "COMPOSIO_MULTI_EXECUTE_TOOL") {
    const slugs = Array.isArray(args.tools)
      ? (args.tools as Array<Record<string, unknown>>).map((t) => String(t.tool_slug ?? t.slug ?? "")).filter(Boolean)
      : [];
    const what = actions(slugs);
    return { done: what, running: `正在执行 ${what}…`, apps: uniqueApps(slugs), lookup: false };
  }

  if (name === "COMPOSIO_SEARCH_TOOLS") {
    const queries = Array.isArray(args.queries) ? (args.queries as Array<Record<string, unknown>>) : [];
    const need = queries.map((q) => String(q.use_case ?? "")).filter(Boolean)[0];
    const short = need ? `“${need.length > 60 ? `${need.slice(0, 57)}…` : need}”` : "合适的应用工具";
    return { done: `已找到用于 ${short} 的工具`, running: `正在查找用于 ${short} 的工具…`, apps: [], lookup: true };
  }

  if (name === "COMPOSIO_GET_TOOL_SCHEMAS") {
    const slugs = Array.isArray(args.tool_slugs) ? (args.tool_slugs as unknown[]).map(String) : [];
    const what = actions(slugs);
    return { done: `已读取 ${what} 的使用方式`, running: `正在读取 ${what} 的使用方式…`, apps: uniqueApps(slugs), lookup: true };
  }

  if (name.startsWith("GITHUB_")) {
    // Dotty's own GitHub tools: "GitHub · get issue (acme/web#42)".
    const where = typeof args.repo === "string" ? ` (${args.repo}${typeof args.number === "number" ? `#${args.number}` : ""})` : "";
    const what = `${describeTool(name).app} · ${describeTool(name).label}${where}`;
    return { done: what, running: `正在使用 ${what}…`, apps: [appOf(name)], lookup: false };
  }

  return { done: "已使用应用", running: "正在使用应用…", apps: [], lookup: true };
}
