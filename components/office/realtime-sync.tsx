"use client";

import { useEffect, useRef } from "react";
import { subscribeLive } from "@/lib/supabase/realtime";
import { useOffice } from "./office-provider";

const TABLES = ["bots", "tasks", "activity", "inbox_items", "code_runs"] as const;
/** Safety-net refresh while bots are busy / when idle, in case a realtime event is missed. */
const BUSY_POLL_MS = 5000;
const IDLE_POLL_MS = 30000;

/**
 * Live office: listens to row changes for this workspace (as the signed-in user — RLS applies to
 * Realtime too) and fetches fresh office data as JSON (no page re-render), debounced so a burst
 * causes one fetch.
 * It also catches up after a reconnect, when the tab becomes visible again, and — as a safety net
 * for dropped events — polls gently (fast while any bot is busy, slow otherwise).
 */
export function RealtimeSync({ workspaceId, enabled = true }: { workspaceId: string; enabled?: boolean }) {
  const { snapshot, refreshOffice } = useOffice();
  const busy =
    snapshot.bots.some((b) => b.status === "working" || b.status === "waiting") ||
    snapshot.tasks.some((t) => t.status === "doing" || t.status === "backlog");
  const lastRefresh = useRef(0);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!enabled) return;
    const refresh = () => {
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        lastRefresh.current = Date.now();
        void refreshOffice();
      }, 400);
    };

    const unsubscribe = subscribeLive(
      `office:${workspaceId}`,
      (channel) => {
        for (const table of TABLES) {
          channel = channel.on("postgres_changes", { event: "*", schema: "public", table, filter: `workspace_id=eq.${workspaceId}` }, refresh);
        }
        return channel;
      },
      (rejoined) => {
        if (rejoined) refresh();
      },
    );

    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      window.clearTimeout(timer.current);
      unsubscribe();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [workspaceId, enabled, refreshOffice]);

  // Safety net: if realtime is quiet, refresh anyway every few seconds while work is going on.
  useEffect(() => {
    if (!enabled) return;
    const every = busy ? BUSY_POLL_MS : IDLE_POLL_MS;
    const poll = window.setInterval(() => {
      if (document.visibilityState !== "visible" || Date.now() - lastRefresh.current < every) return;
      lastRefresh.current = Date.now();
      void refreshOffice();
    }, every);
    return () => window.clearInterval(poll);
  }, [enabled, busy, refreshOffice]);

  return null;
}
