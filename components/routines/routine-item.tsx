"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { setRoutineEnabled } from "@/app/(routes)/workspace/routine-actions";
import { useOffice } from "@/components/office/office-provider";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import type { Routine, TaskStatus } from "@/lib/office/types";
import { cn } from "@/lib/utils";

const LAST_RUN: Record<TaskStatus, string> = {
  backlog: "正在启动",
  doing: "正在运行",
  waiting_on_me: "等待你处理",
  done: "已完成",
  failed: "失败",
};

/** One routine: name, bot and schedule (click to edit), next run, last run, and an on/off switch. */
export function RoutineItem({ routine, showBot = true, className }: { routine: Routine; showBot?: boolean; className?: string }) {
  const { botById, canEdit, openEditor, refreshOffice } = useOffice();
  const [on, setOn] = useState(routine.enabled);
  const [pending, startTransition] = useTransition();

  // Follow the saved value when fresh office data arrives (e.g. edited in the dialog).
  const [seen, setSeen] = useState(routine.enabled);
  if (routine.enabled !== seen) {
    setSeen(routine.enabled);
    setOn(routine.enabled);
  }

  const bot = botById.get(routine.botId);
  const toggle = (checked: boolean) => {
    setOn(checked);
    if (!canEdit) return; // demo office: local only
    startTransition(async () => {
      const res = await setRoutineEnabled(routine.id, checked);
      if (!res.ok) {
        setOn(!checked);
        toast.error(`无法${checked ? "启用" : "停用"} ${routine.name}`, { description: res.error });
      }
      void refreshOffice();
    });
  };

  return (
    <div className={cn("flex items-start gap-2", className)}>
      <button
        type="button"
        disabled={!canEdit}
        onClick={() => openEditor({ type: "routine", routineId: routine.id })}
        title={canEdit ? "编辑例行任务" : undefined}
        className="min-w-0 flex-1 rounded-[8px] text-left enabled:hover:bg-panel-sunken"
      >
        <span className="block truncate text-[14px] font-bold text-ink">{routine.name}</span>
        <span className="block truncate text-[12.5px] text-ink-muted">
          {showBot && bot ? `${bot.name} · ` : ""}
          {routine.schedule}
        </span>
        {routine.lastRun && (
          <span className={cn("block truncate font-mono text-[11px]", routine.lastRun.status === "failed" ? "text-[#b5473f]" : "text-ink-muted")}>
            上次运行：{LAST_RUN[routine.lastRun.status]}
            {routine.lastRun.status === "done" || routine.lastRun.status === "failed" ? ` · ${routine.lastRun.ago}前` : ""}
          </span>
        )}
      </button>
      <span className="flex shrink-0 flex-col items-end gap-1.5">
        <Badge variant="outline" className="border-ink/40 bg-chip-sky font-mono text-[11px] text-ink">
          {on ? (routine.enabled ? routine.nextRunIn : "正在安排…") : "已暂停"}
        </Badge>
        <Switch
          size="sm"
          checked={on}
          disabled={pending}
          onCheckedChange={toggle}
          aria-label={`${on ? "停用" : "启用"} ${routine.name}`}
          className="data-checked:bg-status-working"
        />
      </span>
    </div>
  );
}
