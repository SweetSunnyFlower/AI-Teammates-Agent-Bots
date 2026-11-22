import { loadOffice } from "@/lib/office/load";

/**
 * The office snapshot as JSON, for live updates. The page renders once; after that the client
 * owns the state and swaps in fresh data from here (like a game fetching state) — no
 * router.refresh(), so no page re-render and nothing in the 3D scene gets torn down.
 * The signed-in user's database client inside loadOffice applies ownership predicates, limiting
 * the result to the owner's workspace.
 */
export async function GET(_req: Request, ctx: RouteContext<"/api/office/[workspaceId]">) {
  const { workspaceId } = await ctx.params;
  const snapshot = await loadOffice(workspaceId);
  if (!snapshot) return Response.json({ error: "未找到办公室" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  return Response.json(snapshot, { headers: { "Cache-Control": "no-store" } });
}
