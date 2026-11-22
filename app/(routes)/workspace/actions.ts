"use server";

import { redirect } from "next/navigation";
import { WORKSPACE_ICONS } from "@/lib/office/workspace-icons";
import { hasDatabaseEnv } from "@/lib/db/env";
import { createClient } from "@/lib/db/server";
import { getCurrentUserId } from "@/lib/auth/session";

export type CreateWorkspaceState = { error?: string; name?: string; icon?: string };

/**
 * Creates a workspace and its starter building (Head office, Assistant, Research, Engineering
 * floors with a Lead + worker each) through the `create_workspace` RPC in one transaction. The
 * user-scoped database client applies ownership predicates to later queries.
 */
export async function createWorkspace(_prev: CreateWorkspaceState, formData: FormData): Promise<CreateWorkspaceState> {
  const name = String(formData.get("name") ?? "").trim().replace(/\s+/g, " ");
  const iconRaw = String(formData.get("icon") ?? "");
  const icon = WORKSPACE_ICONS.includes(iconRaw) ? iconRaw : WORKSPACE_ICONS[0];
  const timezone = String(formData.get("timezone") ?? "").slice(0, 64);

  if (!hasDatabaseEnv) return { error: "数据库尚未配置，请在 .env.local 中添加 DATABASE_URL。", name, icon };
  if (name.length < 1 || name.length > 60) return { error: "请填写工作空间名称，最多 60 个字符。", name, icon };

  const userId = await getCurrentUserId();
  if (!userId) redirect("/auth/login?next=/workspace/new");
  const databaseClient = await createClient();

  // Remember the user's timezone for recaps and activity times (first run, or if it changed).
  if (timezone && isValidTimeZone(timezone)) {
    await databaseClient.from("profiles").upsert({ user_id: userId, timezone }, { onConflict: "user_id" });
  }

  const { data: workspaceId, error } = await databaseClient.rpc("create_workspace", { p_name: name, p_icon: icon });
  if (error || typeof workspaceId !== "string") {
    const message = error?.message.includes("Workspace limit")
      ? "你已达到 10 个工作空间的上限。"
      : "创建工作空间失败，请稍后重试。";
    return { error: message, name, icon };
  }

  redirect(`/workspace/${workspaceId}`);
}

function isValidTimeZone(tz: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
