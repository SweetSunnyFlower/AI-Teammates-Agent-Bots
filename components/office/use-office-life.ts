"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { Bot, Department, OfficeSnapshot } from "@/lib/office/types";
import { isAway, walkHome, walkTo } from "./motion";
import { botSeat } from "./scene/constants";

/**
 * The office as a living team (no elevator trips):
 *  - Handoff: the delegating bot walks over to a teammate on the same floor ("Can you take …?" →
 *    "On it 👍"); across floors they talk by 📞.
 *  - Report: when the work is done the worker walks back to whoever asked ("Done ✓ …" → "Nice work!").
 *  - Resting bots act like NPCs: now and then one wanders a few steps or chats with a free teammate.
 * Real work always wins: a bot that gets busy heads straight back to its desk.
 */

export interface BotBubble {
  text: string;
  kind: "start" | "done" | "fail" | "info" | "ask";
  key: number;
}

type Place = { floorId: string; x: number; z: number; shown: boolean };

const SMALL_TALK: Array<[string, string]> = [
  ["Coffee? ☕", "Always 😄"],
  ["How's it going?", "Busy day, good day 💪"],
  ["Nice work earlier!", "Thanks! 🙌"],
  ["Lunch later?", "Count me in 🍜"],
  ["Did you see the board?", "Looking good 👀"],
  ["Stretch break?", "Good idea 🙆"],
];
const THANKS = ["Nice work! 🙌", "Thanks! 👏", "Great job ✨", "Perfect, thanks!"];
const WANDER_LINES = ["☕", "🌿", "Stretching…", "🎵", "Quick break"];

const pick = <T,>(list: T[]) => list[Math.floor(Math.random() * list.length)];
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function useOfficeLife({
  snapshot,
  floors,
  botsByFloor,
  elevator,
  visibleFloors,
  focusedFloorId,
  openReply,
  revealSection,
}: {
  snapshot: OfficeSnapshot;
  floors: Department[];
  botsByFloor: Map<string, Bot[]>;
  elevator: number;
  visibleFloors: number;
  focusedFloorId: string | null;
  openReply: (botId: string, taskId: string) => void;
  revealSection: (section: "waiting") => void;
}) {
  const [bubbles, setBubbles] = useState<Record<string, BotBubble>>({});
  const timers = useRef(new Set<number>());
  /** Bots in a scene (walking/talking) until this time — NPC wandering leaves them alone. */
  const busyUntil = useRef(new Map<string, number>());
  const latest = useRef({ snapshot, places: new Map<string, Place>() });

  useEffect(() => {
    const set = timers.current;
    return () => set.forEach((t) => window.clearTimeout(t));
  }, []);

  // Where every bot sits, and whether its floor is on screen (inside the window, not dimmed).
  useEffect(() => {
    const places = new Map<string, Place>();
    const n = floors.length;
    floors.forEach((f, i) => {
      const b = n - 1 - i;
      const shown = b >= elevator && b < elevator + visibleFloors && (focusedFloorId === null || focusedFloorId === f.id);
      (botsByFloor.get(f.id) ?? []).forEach((bot, slot) => {
        const [x, , z] = botSeat(i, n, slot);
        places.set(bot.id, { floorId: f.id, x, z, shown });
      });
    });
    latest.current = { snapshot, places };
  }, [snapshot, floors, botsByFloor, elevator, visibleFloors, focusedFloorId]);

  const later = useCallback((ms: number, fn: () => void) => {
    const id = window.setTimeout(() => {
      timers.current.delete(id);
      fn();
    }, ms);
    timers.current.add(id);
  }, []);

  const say = useCallback(
    (botId: string, text: string, kind: BotBubble["kind"], ms = kind === "ask" ? 20000 : kind === "start" || kind === "info" ? 5000 : 8000) => {
      const key = Date.now() + Math.random();
      setBubbles((b) => ({ ...b, [botId]: { text, kind, key } }));
      later(ms, () => setBubbles((b) => (b[botId]?.key === key ? Object.fromEntries(Object.entries(b).filter(([id]) => id !== botId)) : b)));
    },
    [later],
  );

  const reserve = (ids: string[], ms: number) => {
    const until = Date.now() + ms;
    for (const id of ids) busyUntil.current.set(id, Math.max(busyUntil.current.get(id) ?? 0, until));
  };

  /**
   * `from` goes over to `to` and they exchange two lines. Same visible floor → a real walk;
   * otherwise (other floor, hidden, reduced motion) → a 📞 call with the same lines.
   */
  const visit = useCallback(
    (fromId: string, toId: string, line: string, reply: string, kinds: [BotBubble["kind"], BotBubble["kind"]]) => {
      const { places } = latest.current;
      const a = places.get(fromId);
      const b = places.get(toId);
      if (a && b && a.floorId === b.floorId && a.shown && !reducedMotion()) {
        if (isAway(toId)) walkHome(toId, 500);
        // Stand beside the teammate, on the side facing where we came from.
        const side = b.x >= a.x ? -0.8 : 0.8;
        const go = walkTo(fromId, b.x + side - a.x, b.z - a.z);
        reserve([fromId, toId], go * 2 + 3600);
        later(go, () => say(fromId, line, kinds[0], 4200));
        later(go + 1500, () => say(toId, reply, kinds[1], 4200));
        later(go + 3400, () => walkHome(fromId));
      } else {
        reserve([fromId, toId], 3000);
        say(fromId, `📞 ${line}`, kinds[0], 4500);
        later(1400, () => say(toId, `📞 ${reply}`, kinds[1], 4500));
      }
    },
    [later, say],
  );

  // Activity → scenes, bubbles and toasts (only for activity that arrives after page load).
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    const ids = snapshot.activity.map((a) => a.id);
    if (!seen.current) {
      seen.current = new Set(ids);
      return;
    }
    const known = seen.current;
    const fresh = snapshot.activity.filter((a) => !known.has(a.id)).reverse(); // oldest first
    ids.forEach((id) => known.add(id));

    for (const a of fresh) {
      const bot = snapshot.bots.find((b) => b.id === a.botId);
      if (!bot) continue;
      const task = a.taskId ? snapshot.tasks.find((t) => t.id === a.taskId) : undefined;
      const title = task?.title ?? /“(.+?)”/.exec(a.text)?.[1] ?? a.text;
      const boss = task?.delegatedByBotId && task.delegatedByBotId !== bot.id ? snapshot.bots.find((b) => b.id === task.delegatedByBotId) : undefined;

      if (a.type === "run_started") {
        if (boss) visit(boss.id, bot.id, `${bot.name}, can you take “${title}”?`, "On it 👍", ["info", "start"]);
        else {
          if (isAway(bot.id)) walkHome(bot.id, 500);
          say(bot.id, `On it — ${title}`, "start");
        }
      } else if (a.type === "run_finished") {
        toast.success(`${bot.name} finished`, {
          description: title,
          action: a.taskId ? { label: "Read reply", onClick: () => openReply(bot.id, a.taskId!) } : undefined,
        });
        if (boss) visit(bot.id, boss.id, `Done ✓ ${title}`, pick(THANKS), ["done", "info"]);
        else say(bot.id, `Done ✓ ${title}`, "done");
      } else if (a.type === "run_failed") {
        say(bot.id, `Stuck — ${title}`, "fail");
        toast.error(`${bot.name} couldn't finish`, {
          description: title,
          action: a.taskId ? { label: "See why", onClick: () => openReply(bot.id, a.taskId!) } : undefined,
        });
      } else if (a.type === "inbox_requested") {
        const what = a.text.replace(/^(Waiting for your OK|Has a question): /, "");
        if (isAway(bot.id)) walkHome(bot.id, 500);
        say(bot.id, a.text.startsWith("Has a question") ? "Question for you 🙋" : `Need your OK 🙋 ${what}`, "ask");
        toast(`${bot.name} needs you`, {
          description: what,
          duration: 10000,
          action: { label: "Review", onClick: () => revealSection("waiting") },
        });
      } else if (a.type === "inbox_approved") say(bot.id, "Thanks! On it 🚀", "start");
      else if (a.type === "tool" && a.text.startsWith("used ")) say(bot.id, a.text.replace(/^used /, "🛠 "), "info", 3500);
    }
  }, [snapshot.activity, snapshot.bots, snapshot.tasks, openReply, revealSection, say, visit]);

  // Real work wins: a bot that's no longer resting stops wandering (unless it's in a scene).
  useEffect(() => {
    const now = Date.now();
    for (const b of snapshot.bots) {
      if (b.status !== "resting" && isAway(b.id) && (busyUntil.current.get(b.id) ?? 0) < now) walkHome(b.id, 600);
    }
  }, [snapshot.bots]);

  // NPC life for resting bots: every few seconds maybe one wanders or chats with a free teammate.
  // Only while the whole office is idle — a bot strolling off for coffee beside a teammate who is
  // mid-task reads as the office ignoring its work, and it pulls the eye off the bot worth watching.
  // It keeps queued bots still too: they count as "resting", but someone else is working.
  useEffect(() => {
    const tick = window.setInterval(() => {
      if (document.visibilityState !== "visible" || reducedMotion() || Math.random() < 0.45) return;
      const { snapshot: s, places } = latest.current;
      if (s.bots.some((b) => b.status === "working" || b.status === "waiting")) return;
      const now = Date.now();
      const free = s.bots.filter((b) => b.status === "resting" && places.get(b.id)?.shown && (busyUntil.current.get(b.id) ?? 0) < now && !isAway(b.id));
      if (!free.length) return;
      const bot = pick(free);
      const place = places.get(bot.id)!;
      const mates = free.filter((b) => b.id !== bot.id && places.get(b.id)?.floorId === place.floorId);

      if (mates.length && Math.random() < 0.35) {
        const [line, reply] = pick(SMALL_TALK);
        visit(bot.id, pick(mates).id, line, reply, ["info", "info"]);
        return;
      }
      // Wander a few steps around the room, linger, come back.
      const tx = clamp(place.x + rand(-1.8, 1.8), -4.6, 4.6);
      const tz = clamp(place.z + rand(-0.3, 1.2), -2.4, 2.7);
      const go = walkTo(bot.id, tx - place.x, tz - place.z);
      const stay = rand(2500, 5000);
      reserve([bot.id], go * 2 + stay + 500);
      if (Math.random() < 0.4) later(go, () => say(bot.id, pick(WANDER_LINES), "info", 2600));
      later(go + stay, () => walkHome(bot.id));
    }, 6000);
    return () => window.clearInterval(tick);
  }, [later, say, visit]);

  return bubbles;
}
