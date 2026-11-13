"use client";

import { useState, useTransition } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Loader2, MessageCircle, Send, Unplug } from "lucide-react";
import { toast } from "sonner";
import { createTelegramLink, getChannels, unlinkChannel, type ChannelStatus } from "@/app/(routes)/workspace/channel-actions";
import { useOffice } from "@/components/office/office-provider";
import { cn } from "@/lib/utils";

/**
 * Settings → Channels: talk to your bots from Telegram and Slack. Messages go to the Head (or
 * "@Bot name …"); Waiting on me items arrive there with buttons; reports on tasks you sent come back.
 */
export function ChannelsTab() {
  const { snapshot } = useOffice();
  const workspaceId = snapshot.workspace.id;
  const queryClient = useQueryClient();
  const [waitingForTelegram, setWaitingForTelegram] = useState(false);

  const { data, isPending, error } = useQuery({
    queryKey: ["channels", workspaceId],
    queryFn: async () => {
      const res = await getChannels(workspaceId);
      if (!res.ok) throw new Error(res.error);
      return res.status;
    },
    staleTime: 15_000,
    // While the user is pressing Start in Telegram, check every few seconds until it's linked.
    refetchInterval: (q) => (waitingForTelegram && !q.state.data?.telegram.linked ? 3000 : false),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["channels", workspaceId] });

  if (isPending) {
    return (
      <p className="flex items-center gap-2 p-6 text-[13px] text-ink-muted">
        <Loader2 className="size-4 animate-spin" /> Loading channels…
      </p>
    );
  }
  if (error || !data) return <p className="p-6 text-[13px] text-[#b5473f]">{error?.message ?? "Couldn't load channels."}</p>;

  return (
    <div className="flex min-h-0 flex-col gap-4 overflow-y-auto px-6 py-5">
      <div>
        <h3 className="text-[17px] font-extrabold">Channels</h3>
        <p className="text-[13px] text-ink-muted">
          Talk to your bots from your phone. Messages go to your Head bot — start with @ and a bot&apos;s name to talk to that bot. Approvals and
          questions arrive with buttons, and reports on tasks you sent come back there.
        </p>
      </div>
      {!data.stateReady && (
        <SetupNote>
          Add <Code>SUPABASE_DB_URL</Code> (your database connection string) to <Code>.env.local</Code> and restart — channels keep their state in Supabase.
        </SetupNote>
      )}
      <TelegramCard
        status={data}
        workspaceId={workspaceId}
        onLinkStarted={() => setWaitingForTelegram(true)}
        onChanged={refresh}
      />
      <SlackCard status={data} workspaceId={workspaceId} onChanged={refresh} />
    </div>
  );
}

function TelegramCard({
  status,
  workspaceId,
  onLinkStarted,
  onChanged,
}: {
  status: ChannelStatus;
  workspaceId: string;
  onLinkStarted: () => void;
  onChanged: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const { telegram } = status;

  const connect = () =>
    startTransition(async () => {
      const res = await createTelegramLink(workspaceId);
      if (!res.ok) return void toast.error("Couldn't create the link", { description: res.error });
      window.open(res.url, "_blank", "noopener");
      onLinkStarted();
      toast("Press Start in Telegram", { description: "This page updates once it's linked (the link works for 15 minutes)." });
    });
  const unlink = () =>
    startTransition(async () => {
      const res = await unlinkChannel(workspaceId, "telegram");
      if (!res.ok) return void toast.error("Couldn't unlink Telegram", { description: res.error });
      toast.success("Telegram unlinked");
      onChanged();
    });

  return (
    <ChannelCard
      icon={<Send className="size-5" />}
      name="Telegram"
      linked={telegram.linked ? `Linked${telegram.linked.username ? ` as ${telegram.linked.username}` : ""}${telegram.botUsername ? ` · @${telegram.botUsername}` : ""}` : null}
    >
      {!telegram.configured ? (
        <SetupNote>
          Not set up on the server yet. Add <Code>TELEGRAM_BOT_TOKEN</Code>, <Code>TELEGRAM_BOT_USERNAME</Code> and{" "}
          <Code>TELEGRAM_WEBHOOK_SECRET_TOKEN</Code> to <Code>.env.local</Code>, then run <Code>npm run telegram:webhook</Code>.
        </SetupNote>
      ) : telegram.linked ? (
        <button type="button" disabled={pending} onClick={unlink} className="fn-pill text-[#b5473f]">
          <Unplug className="size-3.5" /> Unlink
        </button>
      ) : (
        <button type="button" disabled={pending} onClick={connect} className="fn-pill border-ink bg-ink text-panel hover:bg-ink/85">
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : <ExternalLink className="size-3.5" />} Connect Telegram
        </button>
      )}
    </ChannelCard>
  );
}

function SlackCard({ status, workspaceId, onChanged }: { status: ChannelStatus; workspaceId: string; onChanged: () => void }) {
  const [pending, startTransition] = useTransition();
  const { slack } = status;
  const unlink = () =>
    startTransition(async () => {
      const res = await unlinkChannel(workspaceId, "slack");
      if (!res.ok) return void toast.error("Couldn't unlink Slack", { description: res.error });
      toast.success("Slack unlinked", { description: "You can also remove the Dotty app in Slack." });
      onChanged();
    });

  return (
    <ChannelCard icon={<MessageCircle className="size-5" />} name="Slack" linked={slack.linked ? `Linked to ${slack.linked.teamName ?? "your Slack workspace"}` : null}>
      {!slack.configured ? (
        <SetupNote>
          Not set up on the server yet. Create the Slack app with <Code>npm run slack:manifest</Code>, then add <Code>SLACK_CLIENT_ID</Code>,{" "}
          <Code>SLACK_CLIENT_SECRET</Code>, <Code>SLACK_SIGNING_SECRET</Code> and <Code>SLACK_ENCRYPTION_KEY</Code> to <Code>.env.local</Code>.
        </SetupNote>
      ) : !status.publicUrl ? (
        <SetupNote>
          Slack needs a public https address: set <Code>CHAT_PUBLIC_URL</Code> (your ngrok URL locally) and restart.
        </SetupNote>
      ) : slack.linked ? (
        <button type="button" disabled={pending} onClick={unlink} className="fn-pill text-[#b5473f]">
          <Unplug className="size-3.5" /> Unlink
        </button>
      ) : (
        <a href={`/api/slack/install?workspace=${workspaceId}`} className="fn-pill border-ink bg-ink text-panel hover:bg-ink/85">
          <ExternalLink className="size-3.5" /> Add to Slack
        </a>
      )}
    </ChannelCard>
  );
}

function ChannelCard({ icon, name, linked, children }: { icon: React.ReactNode; name: string; linked: string | null; children: React.ReactNode }) {
  return (
    <section className={cn("flex flex-col gap-3 rounded-[14px] border-2 bg-field p-4", linked ? "border-ink/70" : "border-ink/20")}>
      <div className="flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-[10px] border border-hairline bg-white">{icon}</span>
        <div className="min-w-0">
          <p className="text-[15px] font-extrabold">{name}</p>
          <p className={cn("font-mono text-[12px]", linked ? "text-status-working" : "text-ink-muted")}>{linked ?? "not linked"}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </section>
  );
}

function SetupNote({ children }: { children: React.ReactNode }) {
  return <p className="rounded-[10px] bg-panel-sunken px-3 py-2 text-[12.5px] leading-snug text-ink/80">{children}</p>;
}

function Code({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-white px-1 font-mono text-[11.5px]">{children}</code>;
}
