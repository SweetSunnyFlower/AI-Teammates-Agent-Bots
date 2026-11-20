import { createDbClient } from "./client";

/** Trusted runtime client. Every workspace query must still include workspace_id explicitly. */
export function createAdminClient() {
  return createDbClient(null);
}
