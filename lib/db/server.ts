import "server-only";

import { getCurrentUserId } from "@/lib/auth/session";
import { createDbClient } from "./client";

/** User-scoped database client. Workspace predicates are added automatically. */
export async function createClient() {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("会话已过期，请重新登录。");
  return createDbClient(userId);
}
