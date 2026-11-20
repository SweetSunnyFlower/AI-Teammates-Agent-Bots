import "server-only";

import { getCurrentUserId } from "@/lib/auth/session";
import { createDbClient } from "./client";

/** User-scoped database client. Workspace predicates are added automatically. */
export async function createClient() {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Your session expired — sign in again.");
  return createDbClient(userId);
}
