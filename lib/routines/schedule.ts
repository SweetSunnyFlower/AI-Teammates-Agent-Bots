import { Cron } from "croner";

/**
 * Routine schedules. Stored as a 5-part cron expression plus an IANA timezone; the dialog edits
 * them through simple presets (daily, weekdays, weekly, every N hours) and keeps raw cron for the
 * rest. Safe on the client and the server.
 */
export type ScheduleKind = "daily" | "weekdays" | "weekly" | "hourly" | "custom";

export interface Schedule {
  kind: ScheduleKind;
  /** "HH:MM", 24-hour (daily, weekdays, weekly). */
  time: string;
  /** 0 = Sunday … 6 = Saturday (weekly). */
  day: number;
  /** Every N hours (hourly). */
  everyHours: number;
  /** Raw cron (custom). */
  cron: string;
}

export const DAY_NAMES = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];
export const HOUR_STEPS = [1, 2, 3, 4, 6, 8, 12];

export const DEFAULT_SCHEDULE: Schedule = { kind: "weekdays", time: "08:00", day: 1, everyHours: 3, cron: "0 8 * * 1-5" };

const pad = (n: number) => String(n).padStart(2, "0");

function splitTime(time: string) {
  const [h, m] = time.split(":").map(Number);
  return { h: Number.isInteger(h) && h >= 0 && h < 24 ? h : 8, m: Number.isInteger(m) && m >= 0 && m < 60 ? m : 0 };
}

export function toCron(s: Schedule): string {
  const { h, m } = splitTime(s.time);
  switch (s.kind) {
    case "daily":
      return `${m} ${h} * * *`;
    case "weekdays":
      return `${m} ${h} * * 1-5`;
    case "weekly":
      return `${m} ${h} * * ${s.day}`;
    case "hourly":
      return s.everyHours <= 1 ? "0 * * * *" : `0 */${s.everyHours} * * *`;
    case "custom":
      return s.cron.trim().replace(/\s+/g, " ");
  }
}

/** Recognise the presets in a stored cron expression (anything else is "custom"). */
export function fromCron(cron: string): Schedule {
  const c = cron.trim().replace(/\s+/g, " ");
  const base = { ...DEFAULT_SCHEDULE, cron: c };
  let m = c.match(/^(\d{1,2}) (\d{1,2}) \* \* (\*|1-5|[0-6])$/);
  if (m) {
    const time = `${pad(Number(m[2]))}:${pad(Number(m[1]))}`;
    if (Number(m[1]) < 60 && Number(m[2]) < 24) {
      if (m[3] === "*") return { ...base, kind: "daily", time };
      if (m[3] === "1-5") return { ...base, kind: "weekdays", time };
      return { ...base, kind: "weekly", time, day: Number(m[3]) };
    }
  }
  if (c === "0 * * * *") return { ...base, kind: "hourly", everyHours: 1 };
  m = c.match(/^0 \*\/(\d{1,2}) \* \* \*$/);
  if (m && HOUR_STEPS.includes(Number(m[1]))) return { ...base, kind: "hourly", everyHours: Number(m[1]) };
  return { ...base, kind: "custom" };
}

/** "Weekdays · 08:00", "Every 3 h", or the raw cron for custom schedules. */
export function describeCron(cron: string): string {
  const s = fromCron(cron);
  switch (s.kind) {
    case "daily":
      return `每天 · ${s.time}`;
    case "weekdays":
      return `工作日 · ${s.time}`;
    case "weekly":
      return `${DAY_NAMES[s.day]} · ${s.time}`;
    case "hourly":
      return s.everyHours === 1 ? "每小时" : `每 ${s.everyHours} 小时`;
    case "custom":
      return cron === "* * * * *" ? "每分钟" : `cron ${cron}`;
  }
}

export function isValidTimeZone(tz: string) {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Why a cron expression can't be used, or null if it's fine. */
export function cronError(cron: string): string | null {
  if (cron.trim().split(/\s+/).length !== 5) return "请使用 5 段格式：分 时 日 月 星期（例如 0 8 * * 1-5）。";
  try {
    new Cron(cron, { paused: true, mode: "5-part" });
    return null;
  } catch {
    return "这不是有效的计划时间。";
  }
}

/** The next time a schedule fires after `after`, or null if it never will / is invalid. */
export function nextRunAt(cron: string, timeZone: string, after: Date = new Date()): Date | null {
  try {
    return new Cron(cron, { paused: true, mode: "5-part", timezone: timeZone }).nextRun(after);
  } catch {
    return null;
  }
}
