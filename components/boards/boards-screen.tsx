"use client";

import { useMemo, useState } from "react";
import { GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import { STATUS_META } from "@/lib/office/status";
import type { Bot, OfficeSnapshot, Task, TaskStatus } from "@/lib/office/types";
import { BotAvatar } from "@/components/office/bot-avatar";
import { TopBar } from "@/components/office/top-bar";
import { Badge } from "@/components/ui/badge";
import { Kanban, KanbanBoard, KanbanColumn, KanbanItem, KanbanItemHandle, KanbanOverlay } from "@/components/ui/kanban";
import { ScrollArea } from "@/components/ui/scroll-area";

const COLUMNS: Array<{ id: TaskStatus; title: string; dot: string }> = [
  { id: "backlog", title: "Backlog", dot: STATUS_META.resting.color },
  { id: "doing", title: "Doing", dot: STATUS_META.working.color },
  { id: "waiting_on_me", title: "Waiting on me", dot: STATUS_META.waiting.color },
  { id: "done", title: "Done", dot: "#5c8fd6" },
];

/** Boards: every task in the workspace as a kanban (plan journey 2 / Phase 4). Mock moves only. */
export function BoardsScreen({ snapshot }: { snapshot: OfficeSnapshot }) {
  const botById = useMemo(() => new Map(snapshot.bots.map((b) => [b.id, b])), [snapshot.bots]);
  const [columns, setColumns] = useState<Record<string, Task[]>>(() =>
    Object.fromEntries(COLUMNS.map((c) => [c.id, snapshot.tasks.filter((t) => t.status === c.id)])),
  );
  const taskById = useMemo(() => new Map(Object.values(columns).flat().map((t) => [t.id, t])), [columns]);

  return (
    <main className="lawn-bg flex min-h-dvh flex-col gap-4 p-3 lg:h-dvh lg:overflow-hidden lg:p-4">
      <TopBar
        workspace={snapshot.workspace}
        workspaces={snapshot.workspaces}
        statuses={snapshot.bots.map((b) => b.status)}
        waitingCount={snapshot.inbox.length}
        active="boards"
      />

      <div className="flex items-end justify-between gap-3 px-1">
        <div>
          <h1 className="text-[28px] leading-none font-extrabold text-ink">Boards</h1>
          <p className="mt-1 font-mono text-[13px] text-ink/80">every task across all floors · drag to move</p>
        </div>
      </div>

      <Kanban value={columns} onValueChange={setColumns} getItemValue={(t) => t.id}>
        <KanbanBoard className="min-h-0 flex-1 overflow-x-auto pb-2">
          {COLUMNS.map((col) => (
            <KanbanColumn
              key={col.id}
              value={col.id}
              className="fn-panel flex w-[300px] min-w-[280px] shrink-0 flex-col lg:min-h-0 lg:w-auto lg:flex-1"
            >
              <header className="flex items-center gap-2 px-4 pt-3.5 pb-2">
                <span className="size-2.5 rounded-full" style={{ backgroundColor: col.dot }} />
                <h2 className="font-mono text-[15px] text-ink">{col.title.toLowerCase()}</h2>
                <span className="ml-auto grid h-5 min-w-5 place-items-center rounded-[6px] border-[1.5px] border-ink/70 px-1 font-mono text-[11px]">
                  {columns[col.id]?.length ?? 0}
                </span>
              </header>
              <ScrollArea className="min-h-0 flex-1">
                <div className="flex min-h-24 flex-col gap-2 px-3 pb-3">
                  {(columns[col.id] ?? []).map((task) => (
                    <KanbanItem key={task.id} value={task.id} className="rounded-[12px]">
                      <TaskCard task={task} bot={botById.get(task.assigneeBotId)} delegatedBy={task.delegatedByBotId ? botById.get(task.delegatedByBotId) : undefined} />
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
    </main>
  );
}

function TaskCard({ task, bot, delegatedBy, dragging = false }: { task: Task; bot?: Bot; delegatedBy?: Bot; dragging?: boolean }) {
  return (
    <div
      className={cn(
        "rounded-[12px] border-[1.5px] border-ink/70 bg-field p-3",
        task.status === "waiting_on_me" && "bg-honey",
        dragging && "rotate-1 shadow-[0_8px_20px_-6px_rgb(43_38_32/0.45)]",
      )}
    >
      <div className="flex items-start gap-2">
        <p className="flex-1 text-[14px] leading-snug font-bold text-ink">{task.title}</p>
        {dragging ? (
          // The drag overlay renders outside <KanbanItem>, so it can't use the real handle.
          <span className="-mr-1 grid size-6 shrink-0 cursor-grabbing place-items-center rounded-md text-ink-muted" aria-hidden>
            <GripVertical className="size-4" />
          </span>
        ) : (
          <KanbanItemHandle
            className="-mr-1 grid size-6 shrink-0 cursor-grab place-items-center rounded-md text-ink-muted hover:bg-panel-sunken"
            aria-label="Drag task"
          >
            <GripVertical className="size-4" />
          </KanbanItemHandle>
        )}
      </div>
      <div className="mt-2.5 flex items-center gap-2">
        {bot && <BotAvatar bot={bot} size={24} />}
        <span className="truncate text-[12.5px] font-semibold text-ink/85">{bot?.name}</span>
        <span className="ml-auto font-mono text-[11px] text-ink-muted">{task.updated}</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        <Badge variant="outline" className="border-ink/30 font-mono text-[10.5px] text-ink">
          via {task.source}
        </Badge>
        {delegatedBy && (
          <Badge variant="outline" className="border-ink/30 font-mono text-[10.5px] text-ink">
            from {delegatedBy.name}
          </Badge>
        )}
        {task.subtasks ? (
          <Badge variant="outline" className="border-ink/30 font-mono text-[10.5px] text-ink">
            {task.subtasks} subtasks
          </Badge>
        ) : null}
      </div>
    </div>
  );
}
