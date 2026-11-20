import type { createAdminClient } from "@/lib/db/admin";

/**
 * Engineering spend (D20): each code run may spend at most PER_RUN_CAP_CENTS, and all code runs
 * in a workspace share their own daily cap (`workspaces.daily_engineering_cap_cents`), separate
 * from the other bots' daily cap. Days are UTC, like the main cap.
 */
export const PER_RUN_CAP_CENTS = 200;

type Db = ReturnType<typeof createAdminClient>;

export async function engineeringBudget(db: Db, workspaceId: string) {
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  const [{ data: ws }, { data: runs }] = await Promise.all([
    db
      .from("workspaces")
      .select("daily_engineering_cap_cents")
      .eq("id", workspaceId)
      .single(),
    db
      .from("code_runs")
      .select("cost_cents")
      .eq("workspace_id", workspaceId)
      .gte("created_at", since.toISOString()),
  ]);
  const dailyCap = ws?.daily_engineering_cap_cents ?? 1000;
  const spent = (runs ?? []).reduce(
    (sum: number, r: any) => sum + Number(r.cost_cents ?? 0),
    0,
  );
  return {
    dailyCap,
    spent,
    runCap: Math.max(0, Math.min(PER_RUN_CAP_CENTS, dailyCap - spent)),
  };
}

export const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;
