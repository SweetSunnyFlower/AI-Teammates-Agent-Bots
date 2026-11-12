"use client";

import { Activity, useEffect, useState } from "react";
import { X } from "lucide-react";
import { useOffice } from "@/components/office/office-provider";
import { BoardView } from "./board-view";
import { TaskPanel } from "./task-panel";
import { useBoardUrl } from "./use-board-url";

/**
 * Boards as a full dialog over the office (?board=1). The header stays visible and its Boards
 * button toggles this; a task opens in a side panel (&task=<id>). Esc closes the panel, then the board.
 */
export function BoardDialog() {
  const { snapshot } = useOffice();
  const { open, taskId, closeBoard, openTask, closeTask } = useBoardUrl();

  // Pre-mount the board while the browser is idle, then keep it mounted: opening and closing only
  // switch <Activity> between visible and hidden instead of rebuilding the whole kanban.
  const [warm, setWarm] = useState(false);
  useEffect(() => {
    // Safari has no requestIdleCallback — fall back to a short timeout.
    if ("requestIdleCallback" in window) {
      const id = window.requestIdleCallback(() => setWarm(true), { timeout: 4000 });
      return () => window.cancelIdleCallback(id);
    }
    const id = setTimeout(() => setWarm(true), 1500);
    return () => clearTimeout(id);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || document.querySelector("[role=dialog][data-open]")) return; // another dialog handles it
      if (taskId) closeTask();
      else closeBoard();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, taskId, closeBoard, closeTask]);

  if (!open && !warm) return null;
  const total = snapshot.tasks.length;

  return (
    <Activity mode={open ? "visible" : "hidden"} name="board">
    <section
      aria-label="Boards"
      className="animate-in fade-in slide-in-from-top-2 fixed inset-x-3 top-[76px] bottom-3 z-30 flex flex-col gap-3 rounded-[18px] border-2 border-ink bg-panel/95 p-3 shadow-[0_5px_0_0_var(--lip)] backdrop-blur-sm duration-200 lg:inset-x-4 lg:top-[80px] lg:bottom-4 lg:p-4"
    >
      <header className="flex items-center gap-3 px-1">
        <div className="min-w-0">
          <h2 className="text-[22px] leading-none font-extrabold text-ink">Boards</h2>
          <p className="mt-1 font-mono text-[12.5px] text-ink-muted">
            {total} task{total === 1 ? "" : "s"} across all floors · drag a card to move it · click to open
          </p>
        </div>
        <button type="button" onClick={closeBoard} className="fn-sticker ml-auto h-10 px-3 text-[14px]" aria-label="Close board">
          <X className="size-4" /> Close
        </button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <BoardView selectedTaskId={taskId} onSelectTask={openTask} />
        </div>
        {taskId && <TaskPanel key={taskId} taskId={taskId} onClose={closeTask} onSelectTask={openTask} />}
      </div>
    </section>
    </Activity>
  );
}
