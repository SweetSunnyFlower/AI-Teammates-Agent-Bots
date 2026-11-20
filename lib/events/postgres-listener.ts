import pg from "pg";
import { dottyEventBus } from "./server-bus";
import { parseDottyChange } from "./types";

type ListenerState = {
  client: pg.Client | null;
  starting: Promise<void> | null;
  retryTimer: NodeJS.Timeout | null;
  stopped: boolean;
};

type ListenerGlobal = typeof globalThis & {
  __dottyPostgresListener?: ListenerState;
};

function state() {
  const shared = globalThis as ListenerGlobal;
  shared.__dottyPostgresListener ??= {
    client: null,
    starting: null,
    retryTimer: null,
    stopped: false,
  };
  return shared.__dottyPostgresListener;
}

async function connect() {
  const current = state();
  if (current.client) return;
  if (!process.env.DATABASE_URL) throw new Error("实时事件需要 DATABASE_URL。");

  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    application_name: "dotty-events",
    ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
  });
  current.client = client;

  client.on("notification", (message) => {
    const change = parseDottyChange(message.payload ?? null);
    if (change) dottyEventBus().emit("change", change);
  });

  client.on("error", (error) => {
    console.error("[events] PostgreSQL listener error", error.message);
  });

  client.on("end", () => {
    if (current.client === client) current.client = null;
    scheduleReconnect();
  });

  await client.connect();
  await client.query("listen dotty_events");
}

function scheduleReconnect() {
  const current = state();
  if (current.stopped || current.retryTimer) return;
  current.retryTimer = setTimeout(() => {
    current.retryTimer = null;
    ensurePostgresListener().catch((error) => {
      console.error("[events] listener reconnect failed", error instanceof Error ? error.message : String(error));
      scheduleReconnect();
    });
  }, 2000);
}

export async function ensurePostgresListener() {
  const current = state();
  current.stopped = false;
  current.starting ??= connect().catch((error) => {
    current.starting = null;
    current.client = null;
    scheduleReconnect();
    throw error;
  });
  await current.starting;
  current.starting = null;
}
