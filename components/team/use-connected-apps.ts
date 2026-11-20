"use client";

import { useQuery } from "@tanstack/react-query";
import type { ConnectedApp } from "@/lib/integrations/composio";

type ConnectedApps = { apps: ConnectedApp[]; error: string | null; setup?: boolean };

/**
 * The workspace's connected apps, cached (TanStack Query) so the bot dialog opens instantly: the
 * first open loads in the background while the rest of the form stays usable; later opens show
 * the cached list at once and refresh quietly. Uses a GET route, so it never blocks saving.
 */
export function useConnectedApps(workspaceId: string, enabled = true) {
  return useQuery({
    queryKey: ["connected-apps", workspaceId],
    queryFn: async ({ signal }): Promise<ConnectedApps> => {
      const res = await fetch(`/api/office/${workspaceId}/apps`, { cache: "no-store", signal });
      const body = (await res.json().catch(() => null)) as ConnectedApps | null;
      return body ?? { apps: [], error: "无法加载应用列表。" };
    },
    enabled,
    staleTime: 60_000,
    gcTime: 30 * 60_000,
    retry: 1,
  });
}
