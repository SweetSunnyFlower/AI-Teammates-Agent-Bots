import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CreateWorkspaceCard } from "@/components/workspace/create-workspace-card";
import { LoadingLabel, Skeleton } from "@/components/ui/skeleton";
import { getCurrentUser, listMyWorkspaces } from "@/lib/office/load";
import { hasDatabaseEnv } from "@/lib/db/env";

export const metadata: Metadata = { title: "New workspace · Dotty" };

export default function NewWorkspacePage() {
  return (
    <main className="lawn-bg grid min-h-dvh place-items-center px-4 py-10">
      <Suspense fallback={<SetupSkeleton />}>
        <NewWorkspace />
      </Suspense>
    </main>
  );
}

async function NewWorkspace() {
  if (!hasDatabaseEnv) redirect("/workspace");
  const user = await getCurrentUser();
  if (!user) redirect("/auth/login?next=/workspace/new");

  const workspaces = await listMyWorkspaces(user.handle);
  // First workspace = onboarding; later ones can cancel back to where they came from.
  return <CreateWorkspaceCard firstTime={workspaces.length === 0} cancelHref={workspaces[0] ? `/workspace/${workspaces[0].id}` : undefined} />;
}

function SetupSkeleton() {
  return (
    <div aria-busy="true" className="grid w-full max-w-[880px] gap-5 md:grid-cols-[1fr_340px]">
      <LoadingLabel>Loading…</LoadingLabel>
      <div className="flex flex-col gap-4 rounded-[18px] border-2 border-ink bg-panel p-6 shadow-[0_5px_0_0_var(--lip)] sm:p-7">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-7 w-2/3" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-10 w-full rounded-[10px]" />
        <Skeleton className="h-10 w-full rounded-[10px]" />
        <Skeleton className="h-11 w-40 self-end rounded-full" />
      </div>
      <div className="hidden flex-col gap-3 rounded-[18px] border-2 border-ink/30 bg-panel/70 p-6 md:flex">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-5/6" />
        <Skeleton className="h-3 w-4/6" />
      </div>
    </div>
  );
}
