type Fields = Record<string, unknown>;

function emit(level: "info" | "warn" | "error", message: string, fields?: Fields) {
  const line = fields ? `${message} ${JSON.stringify(fields)}` : message;
  if (level === "error") console.error(`[jobs] ${line}`);
  else if (level === "warn") console.warn(`[jobs] ${line}`);
  else console.info(`[jobs] ${line}`);
}

export const logger = {
  info: (message: string, fields?: Fields) => emit("info", message, fields),
  warn: (message: string, fields?: Fields) => emit("warn", message, fields),
  error: (message: string, fields?: Fields) => emit("error", message, fields),
};
