"use client";

import { Activity } from "lucide-react";
import { floorTag } from "@/lib/office/floors";
import { countByStatus } from "@/lib/office/status";
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
  const { snapshot, floors, botsByFloor, selectBot } = useOffice();
  const counts = countByStatus(snapshot.bots.map((b) => b.status));
  const summary = [
    counts.working && `${counts.working} working`,
    counts.waiting && `${counts.waiting} waiting`,
    counts.error && `${counts.error} error`,
    counts.resting && `${counts.resting} resting`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <section className="fn-panel flex min-h-0 flex-1 flex-col" aria-label="Whole office">
      <header className="flex items-start justify-between gap-3 px-4 pt-4 pb-2">
        <h2 className="text-[24px] leading-[1.05] font-extrabold text-ink">
          Whole
          <br />
          office
        </h2>
        <p className="max-w-[150px] pt-1 text-right font-mono text-[12.5px] leading-snug text-ink-muted">{summary}</p>
      </header>
      <ScrollArea className="min-h-0 flex-1">
        <div className="px-2 pb-3">
          {floors.map((dept) => (
            <div key={dept.id} className="mt-2">
              <p className="px-2 pb-1 font-mono text-[12.5px] text-ink-muted">{floorTag(dept)}</p>
              <ul>
                {(botsByFloor.get(dept.id) ?? []).map((bot) => (
                  <li key={bot.id}>
                    <button
                      type="button"
                      onClick={() => selectBot(bot.id, "activity")}
                      className="flex w-full items-center gap-2.5 rounded-[10px] px-2 py-1.5 text-left transition-colors hover:bg-panel-sunken"
                    >
                      <BotAvatar bot={bot} size={34} className="shrink-0" />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span className="truncate text-[14.5px] font-bold text-ink">{bot.name}</span>
                          {bot.role !== "worker" && (
                            <Badge variant="outline" className="h-4 border-ink/30 px-1.5 font-mono text-[10px] text-ink-muted">
                              {bot.role}
                            </Badge>
                          )}
                        </span>
                        <span className="block truncate text-[12.5px] text-ink/75">{bot.statusDetail}</span>
                      </span>
                      <BotStatusIndicator status={bot.status} className="size-2.5" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </ScrollArea>
    </section>
  );
}

function ActivityPanel() {
  const { snapshot, botById, selectBot } = useOffice();
  return (
    <section
      className="flex h-[260px] shrink-0 flex-col rounded-[14px] border-2 border-ink bg-night text-white shadow-[0_3px_0_0_var(--lip)]"
      aria-label="Live activity"
    >
      <header className="flex items-center gap-2 px-4 pt-3.5 pb-2">
        <Activity className="size-4.5 text-[#49c285]" strokeWidth={2.5} />
        <h2 className="text-[17px] font-bold">Live Activity</h2>
        <span className="ml-auto flex items-center gap-1.5 font-mono text-[11.5px] text-white/70">
          <StatusDot color="#49c285" pulse className="size-1.5" />
          live
        </span>
      </header>
      <ScrollArea className="min-h-0 flex-1">
        {snapshot.activity.length === 0 && (
          <p className="px-4 py-2 font-mono text-[12.5px] text-white/60">quiet so far — give the Head a task to get things moving.</p>
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
                    onClick={() => bot && selectBot(bot.id, "activity")}
                    className="font-bold text-white hover:underline"
                  >
                    {bot?.name ?? "Someone"}
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
