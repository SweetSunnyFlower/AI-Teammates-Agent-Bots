import { Suspense } from "react";
import { redirect } from "next/navigation";

// Boards is now a dialog over the office (?board=1). Keep old links working.
export default function BoardsRedirectPage({ params }: PageProps<"/workspace/[workspaceId]/boards">) {
  return (
    <Suspense fallback={null}>
      <RedirectToBoard params={params} />
    </Suspense>
  );
}

async function RedirectToBoard({ params }: { params: PageProps<"/workspace/[workspaceId]/boards">["params"] }): Promise<never> {
  const { workspaceId } = await params;
  redirect(`/workspace/${encodeURIComponent(workspaceId)}?board=1`);
}
