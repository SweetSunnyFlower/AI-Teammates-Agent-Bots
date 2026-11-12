"use client";

import { useOffice } from "@/components/office/office-provider";
import { BotDialog } from "./bot-dialog";
import { DepartmentDialog } from "./department-dialog";
import { RoutineDialog } from "./routine-dialog";

/** Mounts whichever team dialog the office asked for (keyed so each open starts fresh). */
export function TeamDialogs() {
  const { editor, canEdit } = useOffice();
  if (!editor || !canEdit) return null;
  if (editor.type === "bot") {
    return <BotDialog key={editor.botId ?? `new-${editor.departmentId ?? ""}`} botId={editor.botId} departmentId={editor.departmentId} />;
  }
  if (editor.type === "routine") {
    return <RoutineDialog key={editor.routineId ?? `new-${editor.botId ?? ""}`} routineId={editor.routineId} botId={editor.botId} />;
  }
  return <DepartmentDialog key={editor.departmentId ?? "new"} departmentId={editor.departmentId} />;
}
