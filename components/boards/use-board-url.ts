"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Board dialog state lives in the URL (?board=1&task=<id>) so it can be shared, bookmarked and
 * closed with Back. It's a tiny external store over `window.location`: only components that call
 * this hook re-render when it changes — not the office, its panels or the 3D scene.
 */
const EVENT = "dotty:board-url";

function subscribe(onChange: () => void) {
  window.addEventListener("popstate", onChange); // Back / Forward
  window.addEventListener(EVENT, onChange); // our own pushes
  return () => {
    window.removeEventListener("popstate", onChange);
    window.removeEventListener(EVENT, onChange);
  };
}

const readSearch = () => window.location.search;
const serverSearch = () => "";

function push(board: boolean, task: string | null) {
  const q = new URLSearchParams(window.location.search);
  if (board) q.set("board", "1");
  else q.delete("board");
  if (board && task) q.set("task", task);
  else q.delete("task");
  const search = q.toString();
  window.history.pushState(window.history.state, "", `${window.location.pathname}${search ? `?${search}` : ""}${window.location.hash}`);
  window.dispatchEvent(new Event(EVENT));
}

export function useBoardUrl() {
  const search = useSyncExternalStore(subscribe, readSearch, serverSearch);
  const q = new URLSearchParams(search);
  const open = q.get("board") === "1";
  const taskId = open ? q.get("task") : null;

  return {
    open,
    taskId,
    openBoard: useCallback(() => push(true, null), []),
    closeBoard: useCallback(() => push(false, null), []),
    toggleBoard: useCallback(() => push(new URLSearchParams(window.location.search).get("board") !== "1", null), []),
    openTask: useCallback((id: string) => push(true, id), []),
    closeTask: useCallback(() => push(true, null), []),
  };
}
