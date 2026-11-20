"use client";

import { Activity, Plus } from "lucide-react";
import { floorTag } from "@/lib/office/floors";
import type { Bot } from "@/lib/office/types";
import { countByStatus, localizeStatusDetail, STATUS_META } from "@/lib/office/status";
import { BotAvatar } from "@/components/office/bot-avatar";
import { BotStatusIndicator } from "@/components/office/bot-status";
import { useOffice } from "@/components/office/office-provider";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { BotDrawer } from "./bot-drawer";
import { StatusDot } from "./panel";

export function RightColumn() {
  const { selectedBotId } = useOffice();
  if (selectedBotId) return <BotDrawer botId={selectedBotId} />;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <WholeOfficePanel />
      <ActivityPanel />
    </div>
  );
}

function WholeOfficePanel() {
  const { snapshot, floors, botsByFloor, departmentById, selectBot, canEdit, openEditor } = useOffice();
  // Whoever is busy is pinned to the top: an Engineering bot on the ground floor was
  // working for minutes without the user noticing, because its floor was off the bottom.
  const active = snapshot.bots.filter((b) => b.status === "working" || b.status === "waiting" || b.status === "error");
  const counts = countByStatus(snapshot.bots.map((b) => b.status));
  const summary = [
    counts.working && `${counts.working} 工作中`,
    counts.waiting && `${counts.waiting} 等待中`,
    counts.error && `${counts.error} 出错`,
    counts.resting && `${counts.resting} 休息中`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <section className="fn-panel flex min-h-0 flex-1 flex-col" aria-label="整个办公室">
      <header className="flex items-start justify-between gap-3 px-4 pt-4 pb-2">
        <h2 className="text-[22px] leading-[1.05] font-extrabold text-ink">整个办公室</h2>
        <p className="max-w-[150px] pt-1 text-right font-mono text-[12.5px] leading-snug text-ink-muted">{summary}</p>
      </header>
      <ScrollArea className="min-h-0 flex-1">
        <div className="px-2 pb-3">
          {snapshot.bots.length === 0 && (
            <div className="mx-2 mt-2 flex flex-col items-start gap-2 rounded-[12px] border-2 border-dashed border-ink/20 p-3">
              <p className="text-[13px] text-ink/80">还没有 Bot。添加一个并给它分配工作后，它就会出现在办公室里。</p>
              {canEdit && (
                <button type="button" className="fn-pill" onClick={() => openEditor({ type: "bot" })}>
                  <Plus className="size-3.5" /> 添加 Bot
                </button>
              )}
            </div>
          )}
          {active.length > 0 && (
            <div
              className="mx-1 mt-2 rounded-[12px] border-2 p-1"
              style={{ borderColor: `${STATUS_META.working.color}99`, backgroundColor: `${STATUS_META.working.color}1f` }}
            >
              <p className="flex items-center gap-1.5 px-2 pb-1 font-mono text-[12.5px] text-ink-muted">
                <StatusDot color={STATUS_META.working.color} pulse className="size-2" />
                正在工作
              </p>
              <ul>
                {active.map((bot) => (
                  <BotRow key={bot.id} bot={bot} onSelect={selectBot} floor={floorTag(departmentById.get(bot.departmentId)!)} />
                ))}
              </ul>
            </div>
          )}
          {floors.map((dept) => (
            <div key={dept.id} className="mt-2">
              <p className="px-2 pb-1 font-mono text-[12.5px] text-ink-muted">{floorTag(dept)}</p>
              {snapshot.bots.length > 0 && !(botsByFloor.get(dept.id) ?? []).length && (
                <p className="flex items-center gap-2 px-2 py-1 text-[12.5px] text-ink-muted">
                  空楼层
                  {canEdit && (
                    <button type="button" className="font-semibold text-ink underline-offset-2 hover:underline" onClick={() => openEditor({ type: "bot", departmentId: dept.id })}>
                      添加 Bot
                    </button>
                  )}
                </p>
              )}
              <ul>
                {(botsByFloor.get(dept.id) ?? []).map((bot) => (
                  <BotRow key={bot.id} bot={bot} onSelect={selectBot} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      </ScrollArea>
    </section>
  );
}

/** One bot: avatar, name, what it's doing, and its status dot (which pings while busy). */
function BotRow({ bot, onSelect, floor }: { bot: Bot; onSelect: (id: string) => void; floor?: string }) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(bot.id)}
        className="flex w-full items-center gap-2.5 rounded-[10px] px-2 py-1.5 text-left transition-colors hover:bg-panel-sunken"
      >
        <BotAvatar bot={bot} size={34} className="shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-[14.5px] font-bold text-ink">{bot.name}</span>
            {bot.role !== "worker" && (
              <Badge variant="outline" className="h-4 border-ink/30 px-1.5 font-mono text-[10px] text-ink-muted">
                {bot.role === "head" ? "总控" : "主管"}
              </Badge>
            )}
            {floor && <span className="shrink-0 font-mono text-[10.5px] text-ink-muted">{floor}</span>}
          </span>
          <span className="block truncate text-[12.5px] text-ink/75">{localizeStatusDetail(bot.statusDetail, bot.status)}</span>
        </span>
        <BotStatusIndicator status={bot.status} className="size-2.5" />
      </button>
    </li>
  );
}

function ActivityPanel() {
  const { snapshot, botById, selectBot, openReply } = useOffice();
  return (
    <section
      className="flex h-[200px] shrink-0 flex-col rounded-[14px] border-2 border-ink bg-night text-white shadow-[0_3px_0_0_var(--lip)]"
      aria-label="实时动态"
    >
      <header className="flex items-center gap-2 px-4 pt-3.5 pb-2">
        <Activity className="size-4.5 text-[#49c285]" strokeWidth={2.5} />
        <h2 className="text-[17px] font-bold">实时动态</h2>
        <span className="ml-auto flex items-center gap-1.5 font-mono text-[11.5px] text-white/70">
          <StatusDot color="#49c285" pulse className="size-1.5" />
          实时
        </span>
      </header>
      <ScrollArea className="min-h-0 flex-1">
        {snapshot.activity.length === 0 && (
          <p className="px-4 py-2 font-mono text-[12.5px] text-white/60">暂时没有动态，给总控 Bot 分配一个任务试试。</p>
        )}
        <ul className="px-4 pb-3">
          {snapshot.activity.map((a) => {
            const bot = botById.get(a.botId);
            return (
              <li key={a.id} className="flex items-baseline gap-2.5 py-[3px] text-[13px] leading-snug">
                <StatusDot color={bot?.avatar.color ?? "#9aa4c2"} className="size-2 translate-y-[-1px]" />
                <span className="w-10 shrink-0 font-mono text-[12px] text-white/55 tabular-nums">{a.time}</span>
                <span className="min-w-0 text-white/85">
                  <button
                    type="button"
                    onClick={() => {
                      if (!bot) return;
                      if (a.taskId && (a.type === "run_finished" || a.type === "run_failed")) openReply(bot.id, a.taskId);
                      else selectBot(bot.id);
                    }}
                    className="font-bold text-white hover:underline"
                  >
                    {bot?.name ?? "某位 Bot"}
                  </button>{" "}
                  {a.text}
                </span>
              </li>
            );
          })}
        </ul>
      </ScrollArea>
    </section>
  );
}
