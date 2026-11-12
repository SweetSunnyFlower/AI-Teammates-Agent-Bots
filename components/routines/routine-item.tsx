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
  backlog: "starting",
  doing: "running now",
  waiting_on_me: "waiting on you",
  done: "done",
  failed: "failed",
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
        toast.error(`Couldn't turn ${checked ? "on" : "off"} ${routine.name}`, { description: res.error });
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
        title={canEdit ? "Edit routine" : undefined}
        className="min-w-0 flex-1 rounded-[8px] text-left enabled:hover:bg-panel-sunken"
      >
        <span className="block truncate text-[14px] font-bold text-ink">{routine.name}</span>
        <span className="block truncate text-[12.5px] text-ink-muted">
          {showBot && bot ? `${bot.name} · ` : ""}
          {routine.schedule}
        </span>
        {routine.lastRun && (
          <span className={cn("block truncate font-mono text-[11px]", routine.lastRun.status === "failed" ? "text-[#b5473f]" : "text-ink-muted")}>
            last run: {LAST_RUN[routine.lastRun.status]}
            {routine.lastRun.status === "done" || routine.lastRun.status === "failed" ? ` · ${routine.lastRun.ago} ago` : ""}
          </span>
        )}
      </button>
      <span className="flex shrink-0 flex-col items-end gap-1.5">
        <Badge variant="outline" className="border-ink/40 bg-chip-sky font-mono text-[11px] text-ink">
          {on ? (routine.enabled ? routine.nextRunIn : "scheduling…") : "paused"}
        </Badge>
        <Switch
          size="sm"
          checked={on}
          disabled={pending}
          onCheckedChange={toggle}
          aria-label={`${on ? "Turn off" : "Turn on"} ${routine.name}`}
          className="data-checked:bg-status-working"
        />
      </span>
    </div>
  );
}
