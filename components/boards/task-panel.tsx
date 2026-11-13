"use client";

import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, CornerLeftUp, MessageSquare, X } from "lucide-react";
import { Streamdown } from "streamdown";
import { loadTaskThread, type TaskDetail, type ThreadItem, type TaskThreadResult } from "@/app/(routes)/workspace/task-actions";
import { BotAvatar } from "@/components/office/bot-avatar";
import { useOffice } from "@/components/office/office-provider";
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { Bot } from "@/lib/office/types";
import { RetryButton } from "./board-view";
import { useBoardUrl } from "./use-board-url";
import { LoadingLabel, Skeleton, SkeletonLines } from "@/components/ui/skeleton";

const STATUS_LABEL: Record<string, { label: string; className: string }> = {
  backlog: { label: "Backlog", className: "bg-panel-sunken" },
  doing: { label: "Doing", className: "bg-[#7f9f6f]/25" },
  waiting_on_me: { label: "Waiting on me", className: "bg-honey" },
  done: { label: "Done", className: "bg-[#5c8fd6]/25" },
  failed: { label: "Failed", className: "bg-danger-bg" },
  cancelled: { label: "Cancelled", className: "bg-panel-sunken" },
};

/**
 * Jira/Notion-style side panel for one task: details, subtasks, and one thread of everything every
 * bot did on it (and on the tasks delegated from it) — starts, hand-offs and full reports.
 */
export function TaskPanel({ taskId, onClose, onSelectTask }: { taskId: string; onClose: () => void; onSelectTask: (id: string) => void }) {
  const { snapshot, botById, selectBot } = useOffice();
  const { closeBoard } = useBoardUrl();
  const queryClient = useQueryClient();
  // Cached per task (TanStack Query): switching between tasks or reopening one is instant.
  const { data } = useQuery<TaskThreadResult>({
    queryKey: ["task-thread", taskId],
    queryFn: () => loadTaskThread(taskId),
    staleTime: 5 * 60_000,
  });

  // Live updates (new reports, status changes) mark cached threads stale; the open one refreshes
  // in the background while the cached version stays on screen.
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    void queryClient.invalidateQueries({ queryKey: ["task-thread"] });
  }, [snapshot.tasks, snapshot.activity, queryClient]);

  const loading = !data;

  return (
    <aside className="flex min-h-0 w-full flex-col rounded-[14px] border-2 border-ink bg-panel shadow-[0_4px_0_0_var(--lip)] lg:w-[460px] lg:shrink-0" aria-label="Task details">
      <div className="flex items-center justify-between gap-2 border-b border-hairline px-4 py-2.5">
        <span className="font-mono text-[12px] text-ink-muted">task</span>
        <button type="button" onClick={onClose} aria-label="Close task" className="grid size-8 place-items-center rounded-[8px] text-ink-muted hover:bg-panel-sunken hover:text-ink">
          <X className="size-4" />
        </button>
      </div>

      {loading ? (
        <div className="flex flex-col gap-5 p-4" aria-busy="true">
          <LoadingLabel>Loading the task…</LoadingLabel>
          <div className="flex flex-col gap-2">
            <Skeleton className="h-5 w-3/4" />
            <div className="flex gap-2">
              <Skeleton className="h-5 w-16 rounded-full" />
              <Skeleton className="h-5 w-24 rounded-full" />
            </div>
          </div>
          <SkeletonLines lines={4} />
          <div className="flex flex-col gap-2">
            <Skeleton className="h-3 w-20" />
            <SkeletonLines lines={3} />
          </div>
        </div>
      ) : !data.ok ? (
        <p className="m-4 rounded-[10px] bg-danger-bg px-3 py-2 text-[13px]">{data.error}</p>
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col gap-5 p-4">
            <Header task={data.task} bots={botById} />

            {data.parent && (
              <button type="button" onClick={() => onSelectTask(data.parent!.id)} className="flex items-center gap-1.5 text-left text-[12.5px] text-ink/75 hover:text-ink">
                <CornerLeftUp className="size-3.5 shrink-0" /> Part of <span className="font-semibold underline underline-offset-2">{data.parent.title}</span>
              </button>
            )}

            {data.task.body && (
              <Section title="details">
                <Streamdown className="text-[13.5px] leading-relaxed text-ink">{data.task.body}</Streamdown>
              </Section>
            )}

            {data.subtasks.length > 0 && (
              <Section title={`subtasks · ${data.subtasks.length}`}>
                <ul className="flex flex-col gap-1">
                  {data.subtasks.map((s) => {
                    const bot = s.assigneeBotId ? botById.get(s.assigneeBotId) : undefined;
                    return (
                      <li key={s.id}>
                        <button
                          type="button"
                          onClick={() => onSelectTask(s.id)}
                          className="flex w-full items-center gap-2 rounded-[10px] px-2 py-1.5 text-left hover:bg-panel-sunken"
                          style={{ paddingLeft: `${8 + (s.depth - data.task.depth - 1) * 14}px` }}
                        >
                          {bot && <BotAvatar bot={bot} size={20} />}
                          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{s.title}</span>
                          <StatusChip status={s.status} small />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </Section>
            )}

            {(data.task.result?.summary || data.task.result?.error) && (
              <Section title={data.task.result.error ? "why it failed" : "result"}>
                {data.task.result.error ? (
                  <p className="rounded-[10px] bg-danger-bg px-3 py-2 text-[13px]">{data.task.result.error}</p>
                ) : (
                  <Streamdown className="text-[13.5px] leading-relaxed text-ink">{data.task.result.summary!}</Streamdown>
                )}
                {data.task.status === "failed" && <RetryButton taskId={data.task.id} />}
              </Section>
            )}

            <Section title="thread · everything the bots did">
              <Thread items={data.thread} rootTask={data.task} subtasks={data.subtasks} bots={botById} />
            </Section>

            {data.task.assigneeBotId && botById.get(data.task.assigneeBotId) && (
              <button
                type="button"
                onClick={() => {
                  closeBoard(); // the bot drawer lives in the office, under this dialog
                  selectBot(data.task.assigneeBotId!, "chat");
                }}
                className="fn-pill w-fit"
                title="Opens the bot's chat in the office"
              >
                <MessageSquare className="size-3.5" /> Chat with {botById.get(data.task.assigneeBotId)!.name}
              </button>
            )}
          </div>
        </ScrollArea>
      )}
    </aside>
  );
}

function Header({ task, bots }: { task: TaskDetail; bots: Map<string, Bot> }) {
  const assignee = task.assigneeBotId ? bots.get(task.assigneeBotId) : undefined;
  const from = task.createdByBotId ? bots.get(task.createdByBotId) : undefined;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-2">
        <h2 className="flex-1 text-[19px] leading-snug font-extrabold text-ink">{task.title}</h2>
        <StatusChip status={task.status} />
      </div>
      <dl className="grid grid-cols-[96px_1fr] gap-x-3 gap-y-1.5 text-[13px]">
        <dt className="font-mono text-[12px] text-ink-muted">assignee</dt>
        <dd className="flex items-center gap-1.5 font-semibold">
          {assignee ? (
            <>
              <BotAvatar bot={assignee} size={20} /> {assignee.name}
            </>
          ) : (
            "—"
          )}
        </dd>
        <dt className="font-mono text-[12px] text-ink-muted">from</dt>
        <dd>{from ? from.name : task.source === "web" ? "You" : task.source}</dd>
        <dt className="font-mono text-[12px] text-ink-muted">created</dt>
        <dd>{when(task.createdAt)}</dd>
        <dt className="font-mono text-[12px] text-ink-muted">updated</dt>
        <dd>{when(task.updatedAt)}</dd>
      </dl>
    </div>
  );
}

function Thread({ items, rootTask, subtasks, bots }: { items: ThreadItem[]; rootTask: TaskDetail; subtasks: TaskDetail[]; bots: Map<string, Bot> }) {
  if (!items.length) return <p className="font-mono text-[12.5px] text-ink-muted">nothing yet — it hasn&apos;t started.</p>;
  const titleOf = (id: string | null) => (id === rootTask.id ? null : subtasks.find((s) => s.id === id)?.title ?? null);
  return (
    <ol className="flex flex-col gap-3">
      {items.map((item) => {
        const bot = item.botId ? bots.get(item.botId) : undefined;
        const sub = titleOf(item.taskId);
        if (item.kind === "activity") {
          return (
            <li key={`a-${item.id}`}>
              <Marker className={cn("text-[12.5px]", item.type === "run_failed" ? "text-[#b5473f]" : "text-ink-muted")}>
                <MarkerIcon className="size-5">{bot ? <BotAvatar bot={bot} size={20} /> : null}</MarkerIcon>
                <MarkerContent>
                  <b className="text-ink">{bot?.name ?? "A bot"}</b> {item.text}
                  {sub && <span className="text-ink-muted"> · on “{sub}”</span>}
                  <span className="ml-1.5 font-mono text-[11px] text-ink-muted">{time(item.at)}</span>
                </MarkerContent>
              </Marker>
            </li>
          );
        }
        return (
          <li key={`r-${item.id}`} className="rounded-[12px] border border-hairline bg-field p-3">
            <div className="mb-1.5 flex items-center gap-2">
              {bot && <BotAvatar bot={bot} size={24} />}
              <span className="text-[13px] font-bold">{bot?.name ?? "Bot"}</span>
              {sub && (
                <span className="flex min-w-0 items-center gap-0.5 truncate rounded-full bg-panel-sunken px-2 py-0.5 font-mono text-[10.5px] text-ink-muted">
                  <ArrowUpRight className="size-3 shrink-0" /> {sub}
                </span>
              )}
              <span className="ml-auto shrink-0 font-mono text-[11px] text-ink-muted">{time(item.at)}</span>
            </div>
            <Streamdown className="text-[13.5px] leading-relaxed text-ink [&_code]:rounded [&_code]:bg-panel-sunken [&_code]:px-1">{item.text}</Streamdown>
          </li>
        );
      })}
    </ol>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="font-mono text-[12px] text-ink-muted">{title}</h3>
      {children}
    </section>
  );
}

function StatusChip({ status, small = false }: { status: string; small?: boolean }) {
  const s = STATUS_LABEL[status] ?? { label: status, className: "bg-panel-sunken" };
  return (
    <span className={cn("shrink-0 rounded-full border-[1.5px] border-ink/40 font-mono text-ink", small ? "px-1.5 text-[10.5px]" : "px-2.5 py-0.5 text-[11.5px]", s.className)}>
      {s.label}
    </span>
  );
}

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
