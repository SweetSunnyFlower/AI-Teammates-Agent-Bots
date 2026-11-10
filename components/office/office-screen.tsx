"use client";

import { useEffect } from "react";
import type { OfficeSnapshot } from "@/lib/office/types";
import { LeftColumn } from "@/components/panels/left-column";
import { RightColumn } from "@/components/panels/right-column";
import { OfficeProvider, useOffice, type RevealSection } from "./office-provider";
import { OfficeStage } from "./office-stage";
import { TopBar } from "./top-bar";
import { TeamDialogs } from "@/components/team/team-dialogs";

/**
 * Office home screen: the 3D garden fills the whole page and the header + panels float over
 * it (dotty-home.jpg). Below lg the same pieces stack: header, office, then panels.
 */
export function OfficeScreen({ snapshot }: { snapshot: OfficeSnapshot }) {
  return (
    <OfficeProvider initialSnapshot={snapshot}>
      <OfficeLayout />
    </OfficeProvider>
  );
}

function OfficeLayout() {
  const { snapshot, revealSection, canEdit, openEditor } = useOffice();

  // Deep links from the Boards page: #waiting, #routines, #add-bot.
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (hash === "waiting" || hash === "routines") revealSection(hash as RevealSection);
    if (hash === "add-bot" && canEdit) openEditor({ type: "bot" });
  }, [revealSection, canEdit, openEditor]);

  return (
    <main className="lawn-bg relative flex min-h-dvh flex-col gap-3 p-3 lg:block lg:h-dvh lg:overflow-hidden lg:p-0">
      {/* Scene layer: full-bleed on desktop, a tall block on small screens */}
      <div className="relative order-2 lg:order-none h-[68vh] overflow-hidden rounded-[14px] lg:absolute lg:inset-0 lg:h-auto lg:rounded-none">
        <OfficeStage />
      </div>

      {/* Floating UI layer: lets drags fall through to the 3D office except on panels */}
      <div className="contents lg:pointer-events-none lg:absolute lg:inset-0 lg:z-10 lg:flex lg:flex-col lg:gap-3 lg:p-4">
        <TopBar
          className="pointer-events-auto order-1 lg:order-none"
          workspace={snapshot.workspace}
          workspaces={snapshot.workspaces}
          statuses={snapshot.bots.map((b) => b.status)}
          waitingCount={snapshot.inbox.length}
          active="office"
          onReveal={revealSection}
          onAddBot={canEdit ? () => openEditor({ type: "bot" }) : undefined}
        />
        <div className="contents lg:grid lg:min-h-0 lg:flex-1 lg:grid-cols-[290px_minmax(0,1fr)_340px] lg:gap-4">
          <div className="pointer-events-auto order-3 lg:order-none lg:min-h-0 lg:overflow-hidden">
            <LeftColumn />
          </div>
          <div className="hidden lg:block" aria-hidden />
          <aside className="pointer-events-auto order-4 lg:order-none flex min-h-[560px] flex-col lg:min-h-0">
            <RightColumn />
          </aside>
        </div>
      </div>
      <TeamDialogs />
    </main>
  );
}

export function OfficeScreenSkeleton() {
  return (
    <main className="lawn-bg grid min-h-dvh place-items-center">
      <p className="rounded-full bg-panel px-3 py-1 font-mono text-[13px] text-ink">opening the office…</p>
    </main>
  );
}
