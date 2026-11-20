"use client";

import { LayoutGrid, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useBoardUrl } from "./use-board-url";

/** Header button that opens/closes the board dialog (its own component, so only it re-renders). */
export function BoardToggleButton() {
  const { open, toggleBoard } = useBoardUrl();
  return (
    <button
      type="button"
      onClick={toggleBoard}
      aria-pressed={open}
      className={cn("fn-sticker", open && "bg-honey")}
      title={open ? "关闭任务看板" : "打开任务看板"}
    >
      {open ? <X className="size-4.5" /> : <LayoutGrid className="size-4.5" />} 任务看板
    </button>
  );
}
