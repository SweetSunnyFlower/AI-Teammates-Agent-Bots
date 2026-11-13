"use client";

import { useEffect } from "react";
import type { OfficeSnapshot } from "@/lib/office/types";
import { LeftColumn } from "@/components/panels/left-column";
import { RightColumn } from "@/components/panels/right-column";
import { OfficeProvider, useOffice, type RevealSection } from "./office-provider";
import { OfficeStage } from "./office-stage";
import { TopBar } from "./top-bar";
import { TeamDialogs } from "@/components/team/team-dialogs";
import { BoardDialog } from "@/components/boards/board-dialog";
import { BoardToggleButton } from "@/components/boards/board-toggle-button";
import { SettingsDialog } from "@/components/settings/settings-dialog";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { RealtimeSync } from "./realtime-sync";

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
  const { snapshot, revealSection, canEdit, openEditor, openReply, openSettings } = useOffice();
  const queryClient = useQueryClient();

  // Back from "Add to Slack": reopen Channels, confirm, and tidy the URL.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get("settings") !== "channels") return;
    const slack = q.get("slack");
    q.delete("settings");
    q.delete("slack");
    const search = q.toString();
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${search ? `?${search}` : ""}${window.location.hash}`);
    if (!canEdit) return;
    void queryClient.invalidateQueries({ queryKey: ["channels"] });
    openSettings("channels");
    if (slack === "connected") toast.success("Slack connected", { description: "Dotty sent you a DM in Slack — message it there." });
    else if (slack === "cancelled") toast("Slack install cancelled");
    else if (slack) toast.error("Couldn't connect Slack", { description: slack === "no-public-url" ? "Set CHAT_PUBLIC_URL (your ngrok URL locally) and restart." : "Try again from Settings → Channels." });
  }, [canEdit, openSettings, queryClient]);

  // Back from Composio's Connect Link: reopen Connectors, confirm, and tidy the URL.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get("settings") !== "connectors") return;
    const connected = q.get("connected");
    const status = q.get("status");
    q.delete("settings");
    q.delete("connected");
    q.delete("status");
    q.delete("connectedAccountId");
    const search = q.toString();
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${search ? `?${search}` : ""}${window.location.hash}`);
    if (!canEdit) return;
    // A connection just changed on Composio's side: drop the cached connectors list.
    void queryClient.invalidateQueries({ queryKey: ["connectors"] });
    openSettings("connectors");
    if (connected && status !== "failed") toast.success(`${connected} connected`, { description: "Your bots can now read from it." });
    else if (connected) toast.error(`Couldn't connect ${connected}`, { description: "Try again from Settings → Connectors." });
  }, [canEdit, openSettings, queryClient]);

  // Deep links from the Boards page: #waiting, #routines, #add-bot.
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (hash === "waiting" || hash === "routines") revealSection(hash as RevealSection);
    if (hash === "add-bot" && canEdit) openEditor({ type: "bot" });
    const reply = /^reply:([0-9a-f-]{36}):([0-9a-f-]{36})$/i.exec(hash);
    if (reply && canEdit) openReply(reply[1], reply[2]);
  }, [revealSection, canEdit, openEditor, openReply]);

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
          boardButton={<BoardToggleButton />}
          onOpenSettings={canEdit ? () => openSettings("connectors") : undefined}
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
      <BoardDialog />
      <SettingsDialog />
      <TeamDialogs />
      <RealtimeSync workspaceId={snapshot.workspace.id} enabled={canEdit} />
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
