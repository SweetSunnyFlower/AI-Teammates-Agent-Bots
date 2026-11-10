"use client";

import { ArrowLeft, Check, Pencil, Send, X } from "lucide-react";
import { floorColors, floorTag } from "@/lib/office/floors";
import { STATUS_META } from "@/lib/office/status";
import { GATED_TOOLS } from "@/lib/office/tools";
import { BotAvatar } from "@/components/office/bot-avatar";
import { useOffice, type DrawerTab } from "@/components/office/office-provider";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
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

const TABS: DrawerTab[] = ["chat", "activity", "routines", "setup"];

/** Bot detail drawer; replaces the Whole office column while a bot is selected. */
export function BotDrawer({ botId }: { botId: string }) {
  const { botById, departmentById, snapshot, selectBot, drawerTab, setDrawerTab, canEdit, openEditor } = useOffice();
  const bot = botById.get(botId);
  if (!bot) return null;
  const dept = departmentById.get(bot.departmentId);
  const meta = STATUS_META[bot.status];
  const chip = dept ? floorColors([...departmentById.values()], dept.id).chip : "#eee";

  return (
    <section className="fn-panel flex min-h-0 flex-1 flex-col" aria-label={`${bot.name} details`}>
      <div className="flex items-center justify-between px-3 pt-3">
        <button type="button" onClick={() => selectBot(null)} className="fn-pill px-2.5 py-1 text-[12px]">
          <ArrowLeft className="size-3.5" /> whole office
        </button>
        <button
          type="button"
          onClick={() => selectBot(null)}
          aria-label="Close"
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
          {dept && <p className="font-mono text-[12px] text-ink-muted">{floorTag(dept)} · {bot.role}</p>}
          <BotStatus status={bot.status} label={bot.status === "waiting" ? "waiting on you" : meta.label} className="mt-1.5" />
        </div>
      </header>
      <p className="mx-4 rounded-[10px] bg-panel-sunken px-3 py-2 text-[13px] leading-snug text-ink/85">{bot.statusDetail}</p>

      <Tabs value={drawerTab} onValueChange={(v) => setDrawerTab(v as DrawerTab)} className="mt-3 min-h-0 flex-1 gap-0">
        <TabsList variant="line" className="w-full justify-start border-b border-hairline px-3">
          {TABS.map((t) => (
            <TabsTrigger key={t} value={t} className="flex-none px-2.5 font-mono text-[13px] capitalize">
              {t}
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
                <li className="font-mono text-[12.5px] text-ink-muted">no routines yet.</li>
              )}
              {snapshot.routines
                .filter((r) => r.botId === bot.id)
                .map((r) => (
                  <li key={r.id} className="flex items-center gap-3 rounded-[12px] border-[1.5px] border-ink/30 p-3">
                    <span className="min-w-0 flex-1">
                      <span className="block text-[14px] font-bold text-ink">{r.name}</span>
                      <span className="block font-mono text-[12px] text-ink-muted">
                        {r.schedule} · {r.nextRunIn}
                      </span>
                    </span>
                    <Switch defaultChecked={r.enabled} size="sm" aria-label={`Toggle ${r.name}`} className="data-checked:bg-status-working" />
                  </li>
                ))}
            </ul>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="setup" className="min-h-0">
          <ScrollArea className="h-full">
            <div className="flex flex-col gap-3 p-4 text-[13px]">
              {canEdit && (
                <button type="button" className="fn-sticker h-10 justify-center" onClick={() => openEditor({ type: "bot", botId: bot.id })}>
                  <Pencil className="size-4" /> Edit bot
                </button>
              )}
              <div>
                <p className="fn-label mb-1">what this bot does</p>
                <p className="leading-snug text-ink">{bot.instructions}</p>
              </div>
              <Separator className="bg-hairline" />
              <div>
                <p className="fn-label mb-1.5">tools</p>
                <div className="flex flex-wrap gap-1.5">
                  {bot.tools.map((t) => (
                    <Badge
                      key={t}
                      variant="outline"
                      className={GATED_TOOLS.has(t) ? "border-status-waiting/70 bg-honey font-mono text-[11px] text-ink" : "border-ink/30 font-mono text-[11px] text-ink"}
                    >
                      {t}
                      {GATED_TOOLS.has(t) && " · needs approval"}
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
  const { snapshot, decideInbox, setDrawerTab } = useOffice();
  const item = snapshot.inbox.find((i) => i.botId === botId);
  if (!item) return null;
  return (
    <div className="mb-4 rounded-[12px] border-[1.5px] border-ink/70 bg-honey p-3">
      <p className="fn-label text-ink/70">{item.kind === "approval" ? `wants to ${item.action}` : "has a question"}</p>
      <p className="mt-0.5 text-[14px] font-bold text-ink">{item.title}</p>
      <p className="mt-1 line-clamp-3 text-[13px] leading-snug text-ink/80">{item.preview}</p>
      <div className="mt-2.5 flex gap-1.5">
        {item.kind === "approval" ? (
          <>
            <button type="button" onClick={() => decideInbox(item, "approve")} className="fn-pill border-ink bg-ink text-panel hover:bg-ink/85">
              <Check className="size-3.5" /> Approve
            </button>
            <button type="button" className="fn-pill" disabled title="Editing arrives with the approval gate (phase 3)">
              <Pencil className="size-3.5" /> Edit
            </button>
            <button type="button" onClick={() => decideInbox(item, "skip")} className="fn-pill text-[#b5473f]">
              <X className="size-3.5" /> Reject
            </button>
          </>
        ) : (
          <>
            <button type="button" onClick={() => setDrawerTab("chat")} className="fn-pill border-ink bg-ink text-panel hover:bg-ink/85">
              Answer
            </button>
            <button type="button" onClick={() => decideInbox(item, "skip")} className="fn-pill">
              Skip
            </button>
          </>
        )}
      </div>
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
    ...finished.map((f) => ({ id: f.id, time: f.ago, title: "finished", description: f.summary })),
  ];

  if (items.length === 0) {
    return <p className="font-mono text-[12.5px] text-ink-muted">no activity yet today.</p>;
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
