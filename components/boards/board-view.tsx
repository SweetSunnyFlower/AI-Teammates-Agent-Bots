"use client";

import { useMemo, useState, useTransition } from "react";
import { RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { setTaskStatus } from "@/app/(routes)/workspace/task-actions";
import { retryTask } from "@/app/(routes)/workspace/team-actions";
import { cn } from "@/lib/utils";
import { STATUS_META } from "@/lib/office/status";
import type { Bot, Task, TaskStatus } from "@/lib/office/types";
import { BotAvatar } from "@/components/office/bot-avatar";
import { useOffice } from "@/components/office/office-provider";
import { Badge } from "@/components/ui/badge";
import { Kanban, KanbanBoard, KanbanColumn, KanbanItem, KanbanOverlay } from "@/components/ui/kanban";
import { ScrollArea } from "@/components/ui/scroll-area";

export const BOARD_COLUMNS: Array<{ id: Exclude<TaskStatus, "failed">; title: string; dot: string }> = [
  { id: "backlog", title: "Backlog", dot: STATUS_META.resting.color },
  { id: "doing", title: "Doing", dot: STATUS_META.working.color },
  { id: "waiting_on_me", title: "Waiting on me", dot: STATUS_META.waiting.color },
  { id: "done", title: "Done", dot: "#5c8fd6" },
];

/** Failed tasks wait in the backlog with a Retry button. */
function toColumns(tasks: Task[]): Record<string, Task[]> {
  return Object.fromEntries(
    BOARD_COLUMNS.map((c) => [c.id, tasks.filter((t) => t.status === c.id || (c.id === "backlog" && t.status === "failed"))]),
  );
}

/**
 * Kanban of every task. The whole card drags (a 4px move starts a drag, so a click still opens
 * the task); dropping in another column saves the new status.
 */
export function BoardView({ selectedTaskId, onSelectTask }: { selectedTaskId: string | null; onSelectTask: (id: string) => void }) {
  const { snapshot, canEdit } = useOffice();
  const { refreshOffice } = useOffice();
  const botById = useMemo(() => new Map(snapshot.bots.map((b) => [b.id, b])), [snapshot.bots]);
  const [columns, setColumns] = useState<Record<string, Task[]>>(() => toColumns(snapshot.tasks));
  // Live updates (Realtime → refreshOffice) bring new tasks: rebuild the columns from them.
  const [sourceTasks, setSourceTasks] = useState(snapshot.tasks);
  if (sourceTasks !== snapshot.tasks) {
    setSourceTasks(snapshot.tasks);
    setColumns(toColumns(snapshot.tasks));
  }
  const taskById = useMemo(() => new Map(Object.values(columns).flat().map((t) => [t.id, t])), [columns]);

  const onValueChange = (next: Record<string, Task[]>) => {
    const before = new Map(Object.entries(columns).flatMap(([col, tasks]) => tasks.map((t) => [t.id, col] as const)));
    let moved: { id: string; to: string } | null = null;
    for (const [col, tasks] of Object.entries(next)) {
      for (const t of tasks) if (before.get(t.id) !== col) moved = { id: t.id, to: col };
    }
    // Reflect the new status on the card right away.
    setColumns(
      moved
        ? Object.fromEntries(Object.entries(next).map(([col, tasks]) => [col, tasks.map((t) => (t.id === moved!.id ? { ...t, status: col as TaskStatus } : t))]))
        : next,
    );
    if (!moved || !canEdit) return;
    const { id, to } = moved;
    void setTaskStatus(id, to).then((res) => {
      if (!res.ok) {
        toast.error("Couldn't move the task", { description: res.error });
        setColumns(toColumns(snapshot.tasks));
      } else {
        void refreshOffice();
      }
    });
  };

  return (
    <Kanban value={columns} onValueChange={onValueChange} getItemValue={(t) => t.id}>
      <KanbanBoard className="min-h-0 flex-1 overflow-x-auto pb-1">
        {BOARD_COLUMNS.map((col) => (
          <KanbanColumn key={col.id} value={col.id} className="flex w-[280px] min-w-[260px] shrink-0 flex-col rounded-[14px] bg-panel-sunken/70 lg:min-h-0 lg:w-auto lg:flex-1">
            <header className="flex items-center gap-2 px-3 pt-3 pb-2">
              <span className="size-2.5 rounded-full" style={{ backgroundColor: col.dot }} />
              <h3 className="font-mono text-[14px] text-ink">{col.title.toLowerCase()}</h3>
              <span className="ml-auto grid h-5 min-w-5 place-items-center rounded-[6px] border-[1.5px] border-ink/70 px-1 font-mono text-[11px]">
                {columns[col.id]?.length ?? 0}
              </span>
            </header>
            <ScrollArea className="min-h-0 flex-1">
              <div className="flex min-h-24 flex-col gap-2 px-2.5 pb-3">
                {(columns[col.id] ?? []).map((task) => (
                  <KanbanItem key={task.id} value={task.id} asHandle className="cursor-grab rounded-[12px] active:cursor-grabbing">
                    <TaskCard
                      task={task}
                      selected={selectedTaskId === task.id}
                      onOpen={() => onSelectTask(task.id)}
                      bot={botById.get(task.assigneeBotId)}
                      delegatedBy={task.delegatedByBotId ? botById.get(task.delegatedByBotId) : undefined}
                    />
                  </KanbanItem>
                ))}
              </div>
            </ScrollArea>
          </KanbanColumn>
        ))}
      </KanbanBoard>
      <KanbanOverlay>
        {({ value, variant }) => {
          if (variant !== "item") return null;
          const task = taskById.get(String(value));
          return task ? <TaskCard task={task} bot={botById.get(task.assigneeBotId)} dragging /> : null;
        }}
      </KanbanOverlay>
    </Kanban>
  );
}

export function RetryButton({ taskId, label = "Retry", quiet = false }: { taskId: string; label?: string; quiet?: boolean }) {
  const { refreshOffice } = useOffice();
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onPointerDown={(e) => e.stopPropagation()} // don't start a card drag
      onClick={(e) => {
        e.stopPropagation(); // don't open the task panel
        startTransition(async () => {
          const res = await retryTask(taskId);
          if (!res.ok) (quiet ? toast.info : toast.error)(quiet ? "Not restarted" : "Couldn't retry", { description: res.error });
          else toast.success("Restarted — the bot is back on it");
          void refreshOffice();
        });
      }}
      className={cn("fn-pill mt-2 px-2.5 py-0.5 text-[11.5px]", quiet ? "border-ink/25 text-ink-muted" : "border-[#b5473f]/60 text-[#b5473f]")}
    >
      <RotateCcw className="size-3" /> {pending ? "Restarting…" : label}
    </button>
  );
}

function TaskCard({
  task,
  bot,
  delegatedBy,
  dragging = false,
  selected = false,
  onOpen,
}: {
  task: Task;
  bot?: Bot;
  delegatedBy?: Bot;
  dragging?: boolean;
  selected?: boolean;
  onOpen?: () => void;
}) {
  return (
    <div
      role={onOpen ? "button" : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (onOpen && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onOpen();
        }
      }}
      aria-label={onOpen ? `Open task: ${task.title}` : undefined}
      className={cn(
        "rounded-[12px] border-[1.5px] border-ink/70 bg-field p-3 transition-shadow outline-none select-none focus-visible:ring-2 focus-visible:ring-ring",
        task.status === "waiting_on_me" && "bg-honey",
        task.status === "failed" && "border-[#b5473f]/70",
        selected && "ring-[3px] ring-[#1d6ff4]/60",
        dragging && "rotate-1 shadow-[0_8px_20px_-6px_rgb(43_38_32/0.45)]",
      )}
    >
      <p className="text-[14px] leading-snug font-bold text-ink">{task.title}</p>
      <div className="mt-2.5 flex items-center gap-2">
        {bot && <BotAvatar bot={bot} size={24} />}
        <span className="truncate text-[12.5px] font-semibold text-ink/85">{bot?.name}</span>
        <span className="ml-auto font-mono text-[11px] text-ink-muted">{task.updated}</span>
      </div>
      {task.result && (
        <p className={cn("mt-2 line-clamp-2 text-[12.5px] leading-snug", task.status === "failed" ? "text-[#b5473f]" : "text-ink/75")}>
          {task.result}
        </p>
      )}
      {task.status === "failed" && !dragging && <RetryButton taskId={task.id} />}
      {task.status === "doing" && !dragging && <RetryButton taskId={task.id} label="Stuck? Restart" quiet />}
      <div className="mt-2 flex flex-wrap gap-1">
        <Badge variant="outline" className="border-ink/30 font-mono text-[10.5px] text-ink">
          via {task.source}
        </Badge>
        {delegatedBy && (
          <Badge variant="outline" className="border-ink/30 font-mono text-[10.5px] text-ink">
            from {delegatedBy.name}
          </Badge>
        )}
      </div>
    </div>
  );
}
