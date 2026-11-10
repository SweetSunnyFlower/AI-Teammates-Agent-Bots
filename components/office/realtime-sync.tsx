"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const TABLES = ["bots", "tasks", "activity", "inbox_items"] as const;

/**
 * Live office: listens to row changes for this workspace (RLS applies to Realtime too) and
 * refreshes the server-rendered data, debounced so a burst of updates causes one refresh.
 */
export function RealtimeSync({ workspaceId, enabled = true }: { workspaceId: string; enabled?: boolean }) {
  const router = useRouter();

  useEffect(() => {
    if (!enabled) return;
    const supabase = createClient();
    let timer: number | undefined;
    const refresh = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => router.refresh(), 400);
    };

    let channel = supabase.channel(`office:${workspaceId}`);
    for (const table of TABLES) {
      channel = channel.on("postgres_changes", { event: "*", schema: "public", table, filter: `workspace_id=eq.${workspaceId}` }, refresh);
    }
    channel.subscribe();

    return () => {
      window.clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [workspaceId, enabled, router]);

  return null;
}
