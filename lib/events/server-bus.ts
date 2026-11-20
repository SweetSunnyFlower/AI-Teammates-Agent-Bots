import { EventEmitter } from "node:events";
import type { DottyChange } from "./types";

type EventGlobal = typeof globalThis & {
  __dottyEventBus?: EventEmitter;
};

export function dottyEventBus() {
  const shared = globalThis as EventGlobal;
  shared.__dottyEventBus ??= new EventEmitter();
  shared.__dottyEventBus.setMaxListeners(1000);
  return shared.__dottyEventBus;
}

export function emitDottyChange(change: DottyChange) {
  dottyEventBus().emit("change", change);
}
