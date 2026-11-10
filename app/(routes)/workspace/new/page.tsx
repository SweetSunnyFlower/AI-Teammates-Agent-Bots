import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CreateWorkspaceCard } from "@/components/workspace/create-workspace-card";
import { OfficeScreenSkeleton } from "@/components/office/office-screen";
import { getCurrentUser, listMyWorkspaces } from "@/lib/office/load";
import { hasSupabaseEnv } from "@/lib/supabase/env";

export const metadata: Metadata = { title: "New workspace · Dotty" };

export default function NewWorkspacePage() {
  return (
    <main className="lawn-bg grid min-h-dvh place-items-center px-4 py-10">
      <Suspense fallback={<OfficeScreenSkeleton />}>
        <NewWorkspace />
      </Suspense>
    </main>
  );
}

async function NewWorkspace() {
  if (!hasSupabaseEnv) redirect("/workspace");
  const user = await getCurrentUser();
  if (!user) redirect("/auth/login?next=/workspace/new");

  const workspaces = await listMyWorkspaces(user.handle);
  // First workspace = onboarding; later ones can cancel back to where they came from.
  return <CreateWorkspaceCard firstTime={workspaces.length === 0} cancelHref={workspaces[0] ? `/workspace/${workspaces[0].id}` : undefined} />;
}
