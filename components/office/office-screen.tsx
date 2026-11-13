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
import { PanelBoundary } from "@/components/errors/panel-boundary";
import { LoadingLabel, Skeleton } from "@/components/ui/skeleton";

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
    const github = q.get("github");
    q.delete("settings");
    q.delete("connected");
    q.delete("status");
    q.delete("github");
    q.delete("connectedAccountId");
    const search = q.toString();
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${search ? `?${search}` : ""}${window.location.hash}`);
    if (!canEdit) return;
    // A connection just changed on Composio's side: drop the cached connectors list.
    void queryClient.invalidateQueries({ queryKey: ["connectors"] });
    void queryClient.invalidateQueries({ queryKey: ["github"] });
    void queryClient.invalidateQueries({ queryKey: ["connected-apps"] });
    openSettings("connectors");
    if (github === "connected") toast.success("GitHub connected", { description: "Bots with GitHub access can now read your repos, issues and pull requests." });
    else if (github === "requested") toast("Waiting for approval", { description: "An organization owner has to approve Dotty's GitHub App first." });
    else if (github === "cancelled") toast("GitHub connection cancelled");
    else if (github === "not-configured") toast.error("GitHub isn't available yet");
    else if (github) toast.error("Couldn't connect GitHub", { description: "Try again from Settings → Connectors." });
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
        <PanelBoundary label="The 3D office">
          <OfficeStage />
        </PanelBoundary>
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
          onOpenSettings={canEdit ? () => openSettings("workspace") : undefined}
        />
        <div className="contents lg:grid lg:min-h-0 lg:flex-1 lg:grid-cols-[290px_minmax(0,1fr)_340px] lg:gap-4">
          <div className="pointer-events-auto order-3 lg:order-none lg:min-h-0 lg:overflow-hidden">
            <PanelBoundary label="This panel">
              <LeftColumn />
            </PanelBoundary>
          </div>
          <div className="hidden lg:block" aria-hidden />
          <aside className="pointer-events-auto order-4 lg:order-none flex min-h-[560px] flex-col lg:min-h-0">
            <PanelBoundary label="This panel">
              <RightColumn />
            </PanelBoundary>
          </aside>
        </div>
      </div>
      <PanelBoundary label="Boards" className="fixed inset-x-0 bottom-4 z-50 grid place-items-center">
        <BoardDialog />
      </PanelBoundary>
      <PanelBoundary label="Settings" className="fixed inset-x-0 bottom-4 z-50 grid place-items-center">
        <SettingsDialog />
      </PanelBoundary>
      <PanelBoundary label="That dialog" className="fixed inset-x-0 bottom-4 z-50 grid place-items-center">
        <TeamDialogs />
      </PanelBoundary>
      <RealtimeSync workspaceId={snapshot.workspace.id} enabled={canEdit} />
    </main>
  );
}

/**
 * Shown while the office loads (first visit and switching workspaces): the same layout as the
 * office — header, left panels, right panels — as soft placeholders over the lawn.
 */
export function OfficeScreenSkeleton() {
  return (
    <main aria-busy="true" className="lawn-bg relative flex min-h-dvh flex-col gap-3 p-3 lg:h-dvh lg:overflow-hidden lg:p-4">
      <LoadingLabel>Opening the office…</LoadingLabel>
      <div className="flex flex-wrap items-center gap-3">
        <div className="fn-sticker h-12 w-[190px] gap-2 px-3">
          <Skeleton className="size-7 rounded-[8px]" />
          <Skeleton className="h-3.5 flex-1" />
        </div>
        <div className="fn-sticker h-12 w-[260px] gap-3 px-4">
          <Skeleton className="h-3 flex-1" />
          <Skeleton className="h-3 flex-1" />
          <Skeleton className="h-3 flex-1" />
        </div>
        <div className="ml-auto flex gap-2.5">
          <Skeleton className="h-12 w-[150px] rounded-[14px] bg-panel/70" />
          <Skeleton className="h-12 w-[110px] rounded-[14px] bg-panel/70" />
          <Skeleton className="size-12 rounded-[14px] bg-panel/70" />
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 lg:grid lg:grid-cols-[290px_minmax(0,1fr)_340px] lg:gap-4">
        <div className="order-2 flex flex-col gap-3 lg:order-none lg:min-h-0">
          <div className="fn-panel flex flex-col gap-3 p-4 lg:flex-1">
            <Skeleton className="h-4 w-20" />
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="size-8 shrink-0" />
                <div className="flex flex-1 flex-col gap-1.5">
                  <Skeleton className="h-3.5 w-3/4" />
                  <Skeleton className="h-2 w-1/3" />
                </div>
              </div>
            ))}
          </div>
          {[0, 1, 2].map((i) => (
            <div key={i} className="fn-panel flex items-center gap-2 px-4 py-3.5">
              <Skeleton className="size-2.5 rounded-full" />
              <Skeleton className="h-3.5 w-28" />
            </div>
          ))}
        </div>
        <div className="order-1 grid h-[68vh] place-items-center lg:order-none lg:h-auto">
          <p className="rounded-full bg-panel/85 px-3 py-1 font-mono text-[13px] text-ink">opening the office…</p>
        </div>
        <div className="order-3 flex flex-col gap-3 lg:order-none lg:min-h-0">
          <div className="fn-panel flex flex-col gap-3 p-4 lg:flex-1">
            <Skeleton className="h-6 w-24" />
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-2.5">
                <Skeleton className="size-[34px] shrink-0 rounded-full" />
                <div className="flex flex-1 flex-col gap-1.5">
                  <Skeleton className="h-3.5 w-1/2" />
                  <Skeleton className="h-2.5 w-3/4" />
                </div>
              </div>
            ))}
          </div>
          <div className="flex h-[260px] shrink-0 flex-col gap-2.5 rounded-[14px] border-2 border-ink bg-night p-4 shadow-[0_3px_0_0_var(--lip)]">
            <Skeleton className="h-4 w-28 bg-white/15" />
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-3 bg-white/10" style={{ width: `${[88, 70, 80, 60][i]}%` }} />
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
