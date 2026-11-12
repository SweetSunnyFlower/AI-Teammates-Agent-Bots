import type { Vector3 } from "three";

/**
 * Bot walking, kept outside React: each bot has an offset (world x/z) from its seat that eases
 * between two points. The canvas' OverlayProjector reads it every frame, so a walk costs no
 * re-renders — and the canvas only keeps drawing frames while someone is actually moving.
 */

type Walk = { fromX: number; fromZ: number; toX: number; toZ: number; start: number; ms: number };

const walks = new Map<string, Walk>();
/** Called when a walk starts, so the on-demand canvas wakes up. */
let wake: (() => void) | null = null;

export function setMotionWake(fn: (() => void) | null) {
  wake = fn;
}

const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

function current(w: Walk, now: number) {
  const t = Math.min(1, (now - w.start) / w.ms);
  const k = ease(t);
  return { x: w.fromX + (w.toX - w.fromX) * k, z: w.fromZ + (w.toZ - w.fromZ) * k, t };
}

/** World-units walking speed (~1.6 units/s), with a floor so short hops don't look jerky. */
const durationFor = (dx: number, dz: number) => Math.max(600, (Math.hypot(dx, dz) / 1.6) * 1000);

/** Walk a bot to an offset from its seat (0,0 = back at its desk). Returns the walk's duration. */
export function walkTo(botId: string, toX: number, toZ: number, ms?: number) {
  const now = performance.now();
  const w = walks.get(botId);
  const from = w ? current(w, now) : { x: 0, z: 0 };
  const duration = ms ?? durationFor(toX - from.x, toZ - from.z);
  walks.set(botId, { fromX: from.x, fromZ: from.z, toX, toZ, start: now, ms: duration });
  wake?.();
  return duration;
}

export const walkHome = (botId: string, ms?: number) => walkTo(botId, 0, 0, ms);

/** Is the bot away from its desk (or on its way)? */
export function isAway(botId: string) {
  const w = walks.get(botId);
  return Boolean(w && (w.toX !== 0 || w.toZ !== 0 || performance.now() - w.start < w.ms));
}

/**
 * Write the bot's current position (seat + offset, with a little step bounce while moving) into
 * `out`. Returns whether it is still moving (the projector keeps frames coming while true).
 */
export function applyMotion(botId: string, seat: Vector3, out: Vector3, now: number) {
  out.copy(seat);
  const w = walks.get(botId);
  if (!w) return false;
  const { x, z, t } = current(w, now);
  out.x += x;
  out.z += z;
  const moving = t < 1;
  if (moving) out.y += Math.abs(Math.sin((now - w.start) / 110)) * 0.09;
  else if (w.toX === 0 && w.toZ === 0) walks.delete(botId); // home and settled
  return moving;
}

export function anyMoving(now: number) {
  for (const w of walks.values()) if (now - w.start < w.ms) return true;
  return false;
}
