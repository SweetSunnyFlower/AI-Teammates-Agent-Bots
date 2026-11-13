"use client";

import { useState, useTransition } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ExternalLink, Loader2, Unplug } from "lucide-react";
import { toast } from "sonner";
import { getGitHubStatus, unlinkGitHub } from "@/app/(routes)/workspace/github-actions";
import { cn } from "@/lib/utils";

const LOGO = "https://logos.composio.dev/api/github";

/**
 * GitHub in Settings → Connectors. Unlike the other apps it's Dotty's own GitHub App (bots read
 * issues and pull requests, and Engineering bots will code in a sandbox), so it has its own card.
 */
export function GitHubCard({ workspaceId }: { workspaceId: string }) {
  const queryClient = useQueryClient();
  const [pending, startTransition] = useTransition();
  const [confirm, setConfirm] = useState(false);
  const { data, isPending, error } = useQuery({
    queryKey: ["github", workspaceId],
    queryFn: async () => {
      const res = await getGitHubStatus(workspaceId);
      if (!res.ok) throw new Error(res.error);
      return res.status;
    },
    staleTime: 60_000,
  });
  const link = data?.link;
  const connected = link?.status === "active";
  const installHref = `/api/github/install?workspace=${workspaceId}`;

  const unlink = () =>
    startTransition(async () => {
      const res = await unlinkGitHub(workspaceId);
      if (!res.ok) return void toast.error("Couldn't disconnect GitHub", { description: res.error });
      toast.success("GitHub disconnected", { description: "Dotty's app is still installed on GitHub — remove it there if you like." });
      setConfirm(false);
      void queryClient.invalidateQueries({ queryKey: ["github", workspaceId] });
      void queryClient.invalidateQueries({ queryKey: ["connected-apps", workspaceId] });
    });

  const statusLine = isPending
    ? "checking…"
    : error
      ? "couldn't check"
      : !link
        ? "not connected"
        : !connected
          ? "needs reconnecting"
          : [`connected${link.account ? ` · ${link.account}` : ""}`, link.repoCount !== null ? `${link.repoCount} repo${link.repoCount === 1 ? "" : "s"}` : null]
              .filter(Boolean)
              .join(" · ");

  return (
    <li className={cn("flex flex-col gap-2 rounded-[12px] border-2 bg-field p-3 sm:col-span-2", connected ? "border-ink/70" : "border-ink/20")}>
      <div className="flex items-center gap-3">
        <span className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-[9px] border border-hairline bg-white">
          {/* eslint-disable-next-line @next/next/no-img-element -- app logo from Composio's CDN, like the other connectors */}
          <img src={LOGO} alt="" className="size-6 object-contain" loading="lazy" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-bold">GitHub</span>
          <span className={cn("flex items-center gap-1 truncate font-mono text-[11.5px]", connected ? "text-[#2e8b3e]" : link ? "text-[#b5473f]" : "text-ink-muted")}>
            {connected ? <Check className="size-3 shrink-0" strokeWidth={3} /> : null} {statusLine}
          </span>
        </span>
        {isPending ? (
          <Loader2 className="size-4 animate-spin text-ink-muted" />
        ) : !data?.configured ? null : connected ? (
          <span className="flex shrink-0 gap-1">
            <a href={link.manageUrl} target="_blank" rel="noopener noreferrer" className="fn-pill px-2.5">
              <ExternalLink className="size-3.5" /> Choose repos
            </a>
            {confirm ? (
              <>
                <button type="button" onClick={unlink} disabled={pending} className="fn-pill border-[#b5473f] bg-[#dd6d62] px-2.5 text-white">
                  {pending ? <Loader2 className="size-3.5 animate-spin" /> : "Disconnect"}
                </button>
                <button type="button" onClick={() => setConfirm(false)} className="fn-pill px-2.5">
                  Keep
                </button>
              </>
            ) : (
              <button type="button" onClick={() => setConfirm(true)} className="fn-pill px-2.5" aria-label="Disconnect GitHub">
                <Unplug className="size-3.5" />
              </button>
            )}
          </span>
        ) : (
          <a href={installHref} className="fn-sticker h-8 shrink-0 bg-[#1d6ff4] px-3 text-[13px] text-white">
            {link ? "Reconnect" : "Connect"}
          </a>
        )}
      </div>
      {connected && link.repos?.length ? (
        <p className="truncate pl-12 font-mono text-[11.5px] text-ink-muted">
          {link.repos.join(" · ")}
          {link.repoCount && link.repoCount > link.repos.length ? ` · +${link.repoCount - link.repos.length} more` : ""}
        </p>
      ) : connected && link.repoCount === 0 ? (
        <p className="pl-12 text-[12.5px] text-ink/75">No repositories yet — use Choose repos to give Dotty some.</p>
      ) : null}
    </li>
  );
}
