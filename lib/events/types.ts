export type DottyChangeOperation = "insert" | "update" | "delete";

export interface DottyChange {
  table: string;
  op: DottyChangeOperation;
  workspaceId: string;
  botId?: string;
  taskId?: string;
}

export function parseDottyChange(raw: string | null): DottyChange | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<DottyChange>;
    if (
      typeof value.table !== "string" ||
      typeof value.workspaceId !== "string" ||
      !["insert", "update", "delete"].includes(value.op ?? "")
    ) {
      return null;
    }
    return {
      table: value.table,
      op: value.op as DottyChangeOperation,
      workspaceId: value.workspaceId,
      botId: typeof value.botId === "string" ? value.botId : undefined,
      taskId: typeof value.taskId === "string" ? value.taskId : undefined,
    };
  } catch {
    return null;
  }
}
