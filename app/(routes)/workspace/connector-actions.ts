"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { composio, connectionsSession, hasComposio } from "@/lib/integrations/composio";
import { hasDatabaseEnv } from "@/lib/db/env";
import { createClient } from "@/lib/db/server";

export interface ConnectorItem {
  slug: string;
  name: string;
  logo: string | null;
  connected: boolean;
  /** The connected account (for Disconnect). */
  accountId: string | null;
  /** Some apps need no login — they're always available. */
  noAuth: boolean;
}

type Result<T> = ({ ok: true } & T) | { ok: false; error: string; setup?: boolean };

const uuid = z.string().uuid();

/**
 * Not shown from Composio's catalog: its own internal toolkit (meta tools), and GitHub — Dotty has
 * its own GitHub App, shown as its own card (see github-actions.ts).
 */
const HIDDEN_TOOLKITS = new Set(["composio", "github"]);
const NOT_CONFIGURED = "Composio 尚未配置，请在 .env.local 中添加 COMPOSIO_API_KEY 并重启服务。";

/** Only the workspace owner can see or change its connections (checked through RLS). */
async function ownWorkspace(workspaceId: string) {
  if (!hasDatabaseEnv || !uuid.safeParse(workspaceId).success) return false;
  const supabase = await createClient();
  const { data } = await supabase.from("workspaces").select("id").eq("id", workspaceId).maybeSingle();
  return Boolean(data);
}

function friendly(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.error("[composio]", message); // the real error, for debugging (never includes the key)
  if (/401|403|api key|unauthori[sz]ed/i.test(message)) return "Composio 拒绝了 API Key，请检查 COMPOSIO_API_KEY。";
  if (/fetch failed|ENOTFOUND|EAI_AGAIN|ECONN/i.test(message)) return "无法连接 Composio，请检查网络后重试。";
  return message.slice(0, 300);
}

/** One page of the app catalog with this workspace's connection state (connected apps first). */
export async function listConnectors(
  workspaceId: string,
  options: { search?: string; cursor?: string } = {},
): Promise<Result<{ items: ConnectorItem[]; cursor: string | null }>> {
  if (!hasComposio()) return { ok: false, error: NOT_CONFIGURED, setup: true };
  if (!(await ownWorkspace(workspaceId))) return { ok: false, error: "工作空间不存在。" };
  try {
    const session = await connectionsSession(workspaceId);
    const res = await session.toolkits({ search: options.search?.trim() || undefined, cursor: options.cursor, limit: 30 });
    const items = res.items
      .filter((t) => !HIDDEN_TOOLKITS.has(t.slug.toLowerCase()))
      .map(
      (t): ConnectorItem => ({
        slug: t.slug,
        name: t.name,
        logo: t.logo ?? null,
        connected: Boolean(t.connection?.isActive),
        accountId: t.connection?.connectedAccount?.id ?? null,
        noAuth: t.isNoAuth,
      }),
    );
    items.sort((a, b) => Number(b.connected) - Number(a.connected));
    return { ok: true, items, cursor: res.cursor ?? null };
  } catch (error) {
    return { ok: false, error: friendly(error) };
  }
}

/** Start connecting an app: returns Composio's Connect Link (we never build OAuth ourselves). */
export async function connectToolkit(workspaceId: string, slug: string): Promise<Result<{ redirectUrl: string }>> {
  // GitHub is Dotty's own app: its install page, not Composio's.
  if (slug.toLowerCase() === "github" && uuid.safeParse(workspaceId).success) return { ok: true, redirectUrl: `/api/github/install?workspace=${workspaceId}` };
  if (!hasComposio()) return { ok: false, error: NOT_CONFIGURED, setup: true };
  if (!(await ownWorkspace(workspaceId))) return { ok: false, error: "工作空间不存在。" };
  if (!/^[a-z0-9_-]{1,64}$/i.test(slug)) return { ok: false, error: "应用不存在。" };
  try {
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
    const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
    // `||`, not `??`: a blank NEXT_PUBLIC_SITE_URL in .env.local is "" and must fall back too.
    const origin = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, "") || `${proto}://${host}`;
    const session = await connectionsSession(workspaceId);
    const request = await session.authorize(slug, {
      callbackUrl: `${origin}/workspace/${workspaceId}?settings=connectors&connected=${encodeURIComponent(slug)}`,
    });
    if (!request.redirectUrl) return { ok: false, error: "Composio 没有返回这个应用的登录链接。" };
    return { ok: true, redirectUrl: request.redirectUrl };
  } catch (error) {
    return { ok: false, error: friendly(error) };
  }
}

/** Disconnect an app (only an account that belongs to this workspace). */
export async function disconnectToolkit(workspaceId: string, slug: string): Promise<Result<object>> {
  if (!hasComposio()) return { ok: false, error: NOT_CONFIGURED, setup: true };
  if (!(await ownWorkspace(workspaceId))) return { ok: false, error: "工作空间不存在。" };
  try {
    const session = await connectionsSession(workspaceId);
    const res = await session.toolkits({ toolkits: [slug] });
    const accountId = res.items.find((t) => t.slug === slug)?.connection?.connectedAccount?.id;
    if (!accountId) return { ok: false, error: "这个应用尚未连接。" };
    await composio().connectedAccounts.delete(accountId);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: friendly(error) };
  }
}
