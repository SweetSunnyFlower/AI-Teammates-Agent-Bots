"use client";

import { useState, useTransition } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Loader2, MessageCircle, Send, Unplug } from "lucide-react";
import { toast } from "sonner";
import { createTelegramLink, getChannels, unlinkChannel, type ChannelStatus } from "@/app/(routes)/workspace/channel-actions";
import { useOffice } from "@/components/office/office-provider";
import { cn } from "@/lib/utils";
import { LoadingLabel, Skeleton } from "@/components/ui/skeleton";

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
      <div className="flex flex-col gap-4 px-6 py-5" aria-busy="true">
        <LoadingLabel>正在加载渠道…</LoadingLabel>
        <div className="flex flex-col gap-2">
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-3/4" />
        </div>
        {[0, 1].map((i) => (
          <div key={i} className="flex items-center gap-3 rounded-[12px] border-2 border-ink/15 p-4">
            <Skeleton className="size-10 shrink-0 rounded-[10px]" />
            <span className="flex flex-1 flex-col gap-1.5">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-3 w-2/3" />
            </span>
            <Skeleton className="h-8 w-36 rounded-full" />
          </div>
        ))}
      </div>
    );
  }
  if (error || !data) return <p className="p-6 text-[13px] text-[#b5473f]">{error?.message ?? "无法加载渠道。"}</p>;

  return (
    <div className="flex min-h-0 flex-col gap-4 overflow-y-auto px-6 py-5">
      <div>
        <h3 className="text-[17px] font-extrabold">渠道</h3>
        <p className="text-[13px] text-ink-muted">
          可以直接在手机上联系 Bot。普通消息会发送给总控 Bot；以 @ 加上 Bot 名称开头，可以和指定 Bot 对话。审批、问题和任务报告都会回到这里。
        </p>
      </div>
      {!data.stateReady && (
        <SetupNote>
          请将数据库连接字符串 <Code>DATABASE_URL</Code> 添加到 <Code>.env.local</Code> 并重启服务，渠道状态保存在 PostgreSQL 中。
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
      if (!res.ok) return void toast.error("创建关联链接失败", { description: res.error });
      window.open(res.url, "_blank", "noopener");
      onLinkStarted();
      toast("请在 Telegram 中点击“开始”", { description: "关联成功后页面会自动更新，链接 15 分钟内有效。" });
    });
  const unlink = () =>
    startTransition(async () => {
      const res = await unlinkChannel(workspaceId, "telegram");
      if (!res.ok) return void toast.error("解除 Telegram 关联失败", { description: res.error });
      toast.success("Telegram 已解除关联");
      onChanged();
    });

  return (
    <ChannelCard
      icon={<Send className="size-5" />}
      name="Telegram"
      linked={telegram.linked ? `已关联${telegram.linked.username ? `：${telegram.linked.username}` : ""}${telegram.botUsername ? ` · @${telegram.botUsername}` : ""}` : null}
    >
      {!telegram.configured ? (
        <SetupNote>
          服务端尚未配置 Telegram。请将 <Code>TELEGRAM_BOT_TOKEN</Code>、<Code>TELEGRAM_BOT_USERNAME</Code> 和{" "}
          <Code>TELEGRAM_WEBHOOK_SECRET_TOKEN</Code> 添加到 <Code>.env.local</Code>，再运行 <Code>npm run telegram:webhook</Code>。
        </SetupNote>
      ) : telegram.linked ? (
        <button type="button" disabled={pending} onClick={unlink} className="fn-pill text-[#b5473f]">
          <Unplug className="size-3.5" /> 解除关联
        </button>
      ) : (
        <button type="button" disabled={pending} onClick={connect} className="fn-pill border-ink bg-ink text-panel hover:bg-ink/85">
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : <ExternalLink className="size-3.5" />} 连接 Telegram
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
      if (!res.ok) return void toast.error("解除 Slack 关联失败", { description: res.error });
      toast.success("Slack 已解除关联", { description: "你也可以在 Slack 中移除 Dotty 应用。" });
      onChanged();
    });

  return (
    <ChannelCard icon={<MessageCircle className="size-5" />} name="Slack" linked={slack.linked ? `已关联到 ${slack.linked.teamName ?? "你的 Slack 工作区"}` : null}>
      {!slack.configured ? (
        <SetupNote>
          服务端尚未配置 Slack。请运行 <Code>npm run slack:manifest</Code> 创建应用，然后将 <Code>SLACK_CLIENT_ID</Code>、{" "}
          <Code>SLACK_CLIENT_SECRET</Code>、<Code>SLACK_SIGNING_SECRET</Code> 和 <Code>SLACK_ENCRYPTION_KEY</Code> 添加到 <Code>.env.local</Code>。
        </SetupNote>
      ) : !status.publicUrl ? (
        <SetupNote>
          Slack 需要公开的 HTTPS 地址。请设置 <Code>CHAT_PUBLIC_URL</Code>（本地可使用 ngrok 地址）并重启服务。
        </SetupNote>
      ) : slack.linked ? (
        <button type="button" disabled={pending} onClick={unlink} className="fn-pill text-[#b5473f]">
          <Unplug className="size-3.5" /> 解除关联
        </button>
      ) : (
        <a href={`/api/slack/install?workspace=${workspaceId}`} className="fn-pill border-ink bg-ink text-panel hover:bg-ink/85">
          <ExternalLink className="size-3.5" /> 添加到 Slack
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
          <p className={cn("font-mono text-[12px]", linked ? "text-status-working" : "text-ink-muted")}>{linked ?? "未关联"}</p>
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
