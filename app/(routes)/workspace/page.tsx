import { Suspense } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { OfficeScreenSkeleton } from "@/components/office/office-screen";
import { getCurrentUser, LAST_WORKSPACE_COOKIE, listMyWorkspaces } from "@/lib/office/load";
import { DEFAULT_WORKSPACE_ID } from "@/lib/office/mock-data";
import { hasSupabaseEnv } from "@/lib/supabase/env";

/**
 * Entry point after sign-in: new users (no workspace yet) go to create one; everyone else
 * lands in the workspace they used last (or their first one).
 */
export default function WorkspaceIndexPage() {
  return (
    <Suspense fallback={<OfficeScreenSkeleton />}>
      <PickWorkspace />
    </Suspense>
  );
}

async function PickWorkspace(): Promise<never> {
  if (!hasSupabaseEnv) redirect(`/workspace/${DEFAULT_WORKSPACE_ID}`);

  const user = await getCurrentUser();
  if (!user) redirect("/auth/login?next=/workspace");

  const workspaces = await listMyWorkspaces(user.handle);
  if (workspaces.length === 0) redirect("/workspace/new");

  const last = (await cookies()).get(LAST_WORKSPACE_COOKIE)?.value;
  const target = workspaces.find((w) => w.id === last) ?? workspaces[0];
  redirect(`/workspace/${target.id}`);
}
