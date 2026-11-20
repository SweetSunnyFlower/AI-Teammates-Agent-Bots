"use client";

import { ArrowLeft, Pencil, Plus, X } from "lucide-react";
import { floorColors, floorTag } from "@/lib/office/floors";
import { STATUS_META, statusLine } from "@/lib/office/status";
import { GATED_TOOLS } from "@/lib/office/tools";
import { BotAvatar } from "@/components/office/bot-avatar";
import { useOffice, type DrawerTab } from "@/components/office/office-provider";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Timeline,
  TimelineConnector,
  TimelineContent,
  TimelineDescription,
  TimelineDot,
  TimelineHeader,
  TimelineItem,
  TimelineTime,
  TimelineTitle,
} from "@/components/ui/timeline";
import { BotStatus } from "@/components/office/bot-status";
import { BotChat } from "@/components/chat/bot-chat";
import { InboxCard } from "@/components/inbox/inbox-card";
import { RoutineItem } from "@/components/routines/routine-item";

const TABS: DrawerTab[] = ["chat", "activity", "routines", "setup"];
const TAB_LABELS: Record<DrawerTab, string> = {
  chat: "聊天",
  activity: "动态",
  routines: "例行任务",
  setup: "设置",
};

/** Bot detail drawer; replaces the Whole office column while a bot is selected. */
export function BotDrawer({ botId }: { botId: string }) {
  const { botById, departmentById, snapshot, selectBot, drawerTab, setDrawerTab, canEdit, openEditor } = useOffice();
  const bot = botById.get(botId);
  if (!bot) return null;
  const dept = departmentById.get(bot.departmentId);
  const detailLine = statusLine(bot.statusDetail, bot.status);
  const chip = dept ? floorColors([...departmentById.values()], dept.id).chip : "#eee";

  return (
    <section className="fn-panel flex min-h-0 flex-1 flex-col" aria-label={`${bot.name} 详情`}>
      <div className="flex items-center justify-between px-3 pt-3">
        <button type="button" onClick={() => selectBot(null)} className="fn-pill px-2.5 py-1 text-[12px]">
          <ArrowLeft className="size-3.5" /> 整个办公室
        </button>
        <button
          type="button"
          onClick={() => selectBot(null)}
          aria-label="关闭"
          className="grid size-7 place-items-center rounded-md text-ink-muted hover:bg-panel-sunken hover:text-ink"
        >
          <X className="size-4" />
        </button>
      </div>

      <header className="flex items-center gap-3 px-4 pt-3 pb-3">
        <span className="grid size-[72px] shrink-0 place-items-center rounded-[18px] border-[1.5px] border-ink/60" style={{ backgroundColor: chip }}>
          <BotAvatar bot={bot} size={60} animated />
        </span>
        <div className="min-w-0">
          <h2 className="truncate text-[22px] leading-tight font-extrabold text-ink">{bot.name}</h2>
          {dept && <p className="font-mono text-[12px] text-ink-muted">{floorTag(dept)} · {bot.role === "head" ? "总控 Bot" : bot.role === "lead" ? "主管 Bot" : "执行 Bot"}</p>}
          <BotStatus status={bot.status} label={detailLine} className="mt-1.5 max-w-full" />
        </div>
      </header>

      <Tabs value={drawerTab} onValueChange={(v) => setDrawerTab(v as DrawerTab)} className="mt-3 min-h-0 flex-1 gap-0">
        <TabsList variant="line" className="w-full justify-start border-b border-hairline px-3">
          {TABS.map((t) => (
            <TabsTrigger key={t} value={t} className="flex-none px-2.5 font-mono text-[13px] capitalize">
              {TAB_LABELS[t]}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="chat" className="flex min-h-0 flex-col">
          <BotChat key={bot.id} bot={bot} />
        </TabsContent>

        <TabsContent value="activity" className="min-h-0">
          <ScrollArea className="h-full">
            <div className="p-4">
              <PendingApproval botId={bot.id} />
              <BotTimeline botId={bot.id} />
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="routines" className="min-h-0">
          <ScrollArea className="h-full">
            <ul className="flex flex-col gap-3 p-4">
              {snapshot.routines.filter((r) => r.botId === bot.id).length === 0 && (
                <li className="font-mono text-[12.5px] text-ink-muted">还没有例行任务，{bot.name} 只会在收到任务时工作。</li>
              )}
              {snapshot.routines
                .filter((r) => r.botId === bot.id)
                .map((r) => (
                  <li key={r.id} className="rounded-[12px] border-[1.5px] border-ink/30 p-3">
                    <RoutineItem routine={r} showBot={false} />
                  </li>
                ))}
              {canEdit && (
                <li>
                  <button type="button" className="fn-pill" onClick={() => openEditor({ type: "routine", botId: bot.id })}>
                    <Plus className="size-3.5" /> 为 {bot.name} 添加例行任务
                  </button>
                </li>
              )}
            </ul>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="setup" className="min-h-0">
          <ScrollArea className="h-full">
            <div className="flex flex-col gap-3 p-4 text-[13px]">
              {canEdit && (
                <button type="button" className="fn-sticker h-10 justify-center" onClick={() => openEditor({ type: "bot", botId: bot.id })}>
                  <Pencil className="size-4" /> 编辑 Bot
                </button>
              )}
              <div>
                <p className="fn-label mb-1">这个 Bot 负责什么</p>
                <p className="leading-snug text-ink">{bot.instructions}</p>
              </div>
              <Separator className="bg-hairline" />
              <div>
                <p className="fn-label mb-1.5">工具</p>
                <div className="flex flex-wrap gap-1.5">
                  {bot.tools.map((t) => (
                    <Badge
                      key={t}
                      variant="outline"
                      className={GATED_TOOLS.has(t) ? "border-status-waiting/70 bg-honey font-mono text-[11px] text-ink" : "border-ink/30 font-mono text-[11px] text-ink"}
                    >
                      {t}
                      {GATED_TOOLS.has(t) && " · 需要审批"}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </section>
  );
}

function PendingApproval({ botId }: { botId: string }) {
  const { snapshot, botById } = useOffice();
  const bot = botById.get(botId);
  const items = snapshot.inbox.filter((i) => i.botId === botId);
  if (!bot || items.length === 0) return null;
  return (
    <div className="mb-4 flex flex-col gap-2">
      {items.map((item) => (
        <InboxCard key={item.id} item={item} bot={bot} inline />
      ))}
    </div>
  );
}

function BotTimeline({ botId }: { botId: string }) {
  const { snapshot, botById } = useOffice();
  const bot = botById.get(botId);
  const entries = snapshot.activity.filter((a) => a.botId === botId);
  const finished = snapshot.finished.filter((f) => f.botId === botId);
  if (!bot) return null;

  const items = [
    ...entries.map((a) => ({ id: a.id, time: a.time, title: a.text, description: undefined as string | undefined })),
    ...finished.map((f) => ({ id: f.id, time: f.ago, title: "已完成", description: f.summary })),
  ];

  if (items.length === 0) {
    return <p className="font-mono text-[12.5px] text-ink-muted">今天还没有动态。</p>;
  }

  return (
    <Timeline activeIndex={0} className="gap-4">
      {items.map((item, i) => (
        <TimelineItem key={item.id}>
          <TimelineDot
            className="border-[1.5px] border-ink/60"
            style={{ backgroundColor: i === 0 ? STATUS_META[bot.status].color : "#e9e2d4" }}
          />
          <TimelineConnector className="bg-hairline" />
          <TimelineContent>
            <TimelineHeader className="gap-0.5">
              <TimelineTime className="font-mono text-[11.5px] text-ink-muted">{item.time}</TimelineTime>
              <TimelineTitle className="text-[13.5px] leading-snug font-semibold text-ink">
                {bot.name} {item.title}
              </TimelineTitle>
            </TimelineHeader>
            {item.description && (
              <TimelineDescription className="text-[12.5px] text-ink/75">{item.description}</TimelineDescription>
            )}
          </TimelineContent>
        </TimelineItem>
      ))}
    </Timeline>
  );
}
