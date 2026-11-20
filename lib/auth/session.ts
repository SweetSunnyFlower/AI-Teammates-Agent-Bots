import "server-only";

import { headers } from "next/headers";
import { auth } from "@/lib/auth";

export async function getSessionFromHeaders(requestHeaders: Headers) {
  return auth.api.getSession({ headers: requestHeaders });
}

export async function getSession() {
  return getSessionFromHeaders(await headers());
}

export async function getCurrentUserId() {
  const session = await getSession();
  return session?.user?.id ?? null;
}

export async function requireCurrentUserId() {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Your session expired — sign in again.");
  return userId;
}
