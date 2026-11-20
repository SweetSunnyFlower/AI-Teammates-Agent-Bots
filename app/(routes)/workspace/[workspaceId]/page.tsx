import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { OfficeScreen, OfficeScreenSkeleton } from "@/components/office/office-screen";
import { loadOffice } from "@/lib/office/load";

export const metadata: Metadata = { title: "办公室 · Dotty" };

// `params` is request-time data under Cache Components, so it is read inside <Suspense>.
export default function WorkspacePage({ params }: PageProps<"/workspace/[workspaceId]">) {
  return (
    <Suspense fallback={<OfficeScreenSkeleton />}>
      <Office params={params} />
    </Suspense>
  );
}

async function Office({ params }: { params: PageProps<"/workspace/[workspaceId]">["params"] }) {
  const { workspaceId } = await params;
  const snapshot = await loadOffice(workspaceId);
  if (!snapshot) notFound();
  return <OfficeScreen snapshot={snapshot} />;
}
