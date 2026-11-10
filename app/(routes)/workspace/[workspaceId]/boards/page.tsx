import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BoardsScreen } from "@/components/boards/boards-screen";
import { OfficeScreenSkeleton } from "@/components/office/office-screen";
import { loadOffice } from "@/lib/office/load";

export const metadata: Metadata = { title: "Boards · Dotty" };

export default function BoardsPage({ params }: PageProps<"/workspace/[workspaceId]/boards">) {
  return (
    <Suspense fallback={<OfficeScreenSkeleton />}>
      <Boards params={params} />
    </Suspense>
  );
}

async function Boards({ params }: { params: PageProps<"/workspace/[workspaceId]/boards">["params"] }) {
  const { workspaceId } = await params;
  const snapshot = await loadOffice(workspaceId);
  if (!snapshot) notFound();
  return <BoardsScreen snapshot={snapshot} />;
}
