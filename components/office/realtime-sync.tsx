"use client";

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { parseDottyChange } from "@/lib/events/types";
import { useOffice } from "./office-provider";

/** SSE is primary; these are only fallbacks for a missed event or disconnected stream. */
const BUSY_POLL_MS = 15000;
const IDLE_POLL_MS = 60000;

/**
 * Live office: polls fresh office data as JSON (no page re-render), faster while bots are busy.
 * It also catches up whenever the tab becomes visible again.
 */
export function RealtimeSync({ workspaceId, enabled = true }: { workspaceId: string; enabled?: boolean }) {
  const { snapshot, refreshOffice } = useOffice();
  const queryClient = useQueryClient();
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

    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    const events = new EventSource(`/api/events?workspace=${encodeURIComponent(workspaceId)}`);
    events.onopen = () => {
      refresh();
      void queryClient.invalidateQueries({ queryKey: ["thread"] });
    };
    events.addEventListener("change", (event) => {
      const change = parseDottyChange((event as MessageEvent<string>).data);
      if (!change || change.workspaceId !== workspaceId) return;
      if (change.table === "messages") {
        if (change.botId) void queryClient.invalidateQueries({ queryKey: ["thread", change.botId] });
        return;
      }
      refresh();
    });
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      window.clearTimeout(timer.current);
      events.close();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, queryClient, refreshOffice, workspaceId]);

  // Safety net: if realtime is quiet, refresh anyway every few seconds while work is going on.
  useEffect(() => {
    if (!enabled) return;
    const every = busy ? BUSY_POLL_MS : IDLE_POLL_MS;
    const poll = window.setInterval(() => {
      if (document.visibilityState !== "visible" || Date.now() - lastRefresh.current < every) return;
      lastRefresh.current = Date.now();
      void refreshOffice();
      void queryClient.invalidateQueries({ queryKey: ["thread"] });
    }, every);
    return () => window.clearInterval(poll);
  }, [enabled, busy, queryClient, refreshOffice]);

  return null;
}
