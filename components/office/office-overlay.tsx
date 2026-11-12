"use client";

import { memo, useCallback, useMemo } from "react";
import { ClipboardList, Code, Hand, Mail, Search, Sparkles, TriangleAlert } from "lucide-react";
import { Vector3 } from "three";
import { cn } from "@/lib/utils";
import { floorTag } from "@/lib/office/floors";
import { countByStatus, STATUS_META } from "@/lib/office/status";
import type { Bot, Department, DepartmentKind } from "@/lib/office/types";
import { BotAvatar } from "./bot-avatar";
import { useOffice, VISIBLE_FLOORS, type OverlayAnchor } from "./office-provider";
import { AVATAR_LIFT, botSeat, floorCorners } from "./scene/constants";

const KIND_ICON: Record<DepartmentKind, typeof Mail> = {
  head: ClipboardList,
  assistant: Mail,
  research: Search,
  engineering: Code,
  custom: Sparkles,
};

/** Registers a DOM element as an overlay anchor; the canvas writes its transform each frame. */
function useAnchor(id: string, points: Vector3[], mode: OverlayAnchor["mode"], scaleWithZoom: boolean, motionKey?: string) {
  const { registerAnchor } = useOffice();
  return useCallback(
    (el: HTMLDivElement | null) => {
      if (!el) return;
      registerAnchor(id, { el, points, mode, scaleWithZoom, motionKey });
      return () => registerAnchor(id, null);
    },
    [id, points, mode, scaleWithZoom, motionKey, registerAnchor],
  );
}

/**
 * Avatars and floor labels drawn as plain DOM over the canvas (one React tree, no portals).
 * Elements start off-screen and are placed by the canvas' OverlayProjector.
 */
export function OfficeOverlay() {
  const { floors, botsByFloor, focusedFloorId, cleanView, elevator } = useOffice();
  const n = floors.length;

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden={false}>
      {floors.map((dept, i) => {
        // Only floors inside the elevator window get avatars and labels (and their animations).
        const b = n - 1 - i;
        if (b < elevator || b >= elevator + VISIBLE_FLOORS) return null;
        const bots = botsByFloor.get(dept.id) ?? [];
        const dimmed = focusedFloorId !== null && focusedFloorId !== dept.id;
        return (
          <div key={dept.id} className="contents">
            {!cleanView && (
              <FloorLabel department={dept} bots={bots} index={i} floorCount={n} side={i % 2 === 0 ? "left" : "right"} dimmed={dimmed} />
            )}
            {bots.map((bot, slot) => (
              <BotPin key={bot.id} bot={bot} kind={dept.kind} index={i} floorCount={n} slot={slot} dimmed={dimmed} />
            ))}
          </div>
        );
      })}
    </div>
  );
}

const OFFSCREEN = { transform: "translate3d(-9999px, -9999px, 0)", transformOrigin: "0 0" } as const;

const BotPin = memo(function BotPin({
  bot,
  kind,
  index,
  floorCount,
  slot,
  dimmed,
}: {
  bot: Bot;
  kind: DepartmentKind;
  index: number;
  floorCount: number;
  slot: number;
  dimmed: boolean;
}) {
  const { selectBot, selectedBotId, cleanView, bubbles } = useOffice();
  const bubble = bubbles[bot.id];
  const points = useMemo(() => {
    const [x, y, z] = botSeat(index, floorCount, slot);
    return [new Vector3(x, y + AVATAR_LIFT, z)];
  }, [index, floorCount, slot]);
  const ref = useAnchor(`bot:${bot.id}`, points, "point", true, bot.id);

  const meta = STATUS_META[bot.status];
  const selected = selectedBotId === bot.id;
  const Icon = bot.status === "error" ? TriangleAlert : bot.status === "waiting" ? Hand : KIND_ICON[kind];
  // Only busy bots animate; resting/error bots show a still expression (cheaper, calmer).
  const animated = bot.status === "working" || bot.status === "waiting";

  return (
    <div ref={ref} className="bot-pin absolute top-0 left-0 will-change-transform" style={OFFSCREEN}>
      <button
        type="button"
        onClick={() => selectBot(bot.id)}
        className={cn(
          "pointer-events-auto relative grid -translate-x-1/2 -translate-y-full place-items-center rounded-full outline-none animate-in fade-in duration-700",
          "transition-[opacity,translate] duration-300 hover:-translate-y-[calc(100%+2px)] focus-visible:ring-2 focus-visible:ring-ring",
          selected && "ring-[3px] ring-[#f0dab1] ring-offset-0",
        )}
        style={{ opacity: dimmed ? 0.22 : 1 }}
        aria-label={`${bot.name}, ${meta.label}. Open details`}
        title={`${bot.name} · ${bot.statusDetail}`}
      >
        {bubble && <SpeechBubble key={bubble.key} text={bubble.text} color={bot.avatar.color} />}
        <BotAvatar bot={bot} size={44} animated={animated} />
        {!cleanView && bot.status !== "resting" && (
          <span
            className={cn(
              "absolute -top-2 -right-3 grid size-5.5 place-items-center rounded-[8px] border-[1.5px] border-ink/80 bg-panel",
              bot.status === "waiting" && "fn-pulse",
            )}
            style={{ color: meta.color }}
          >
            <Icon className="size-3" strokeWidth={2.5} />
          </span>
        )}
      </button>
    </div>
  );
});

/** Readable text on the bot's color: dark ink on light colors, white on dark ones. */
function textOn(hex: string) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "#2b2620";
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? "#2b2620" : "#ffffff";
}

/**
 * Speech bubble over a bot ("On it — …", "Done ✓ …", "Needs your OK — …"): a flat chat-message
 * bubble in the bot's own color, its tail corner pointing down at the bot.
 */
function SpeechBubble({ text, color }: { text: string; color: string }) {
  return (
    <span
      role="status"
      className={cn(
        "pointer-events-none absolute bottom-full left-1/2 mb-2 max-w-[220px] -translate-x-3 truncate rounded-[16px] rounded-bl-[4px] px-3 py-1.5 text-[12.5px] font-bold whitespace-nowrap",
        "animate-in fade-in zoom-in-90 slide-in-from-bottom-1 duration-300 origin-bottom-left",
      )}
      style={{ backgroundColor: color, color: textOn(color) }}
    >
      {text}
    </span>
  );
}

const FloorLabel = memo(function FloorLabel({
  department,
  bots,
  index,
  floorCount,
  side,
  dimmed,
}: {
  department: Department;
  bots: Bot[];
  index: number;
  floorCount: number;
  side: "left" | "right";
  dimmed: boolean;
}) {
  const { focusFloor, focusedFloorId } = useOffice();
  const points = useMemo(() => floorCorners(index, floorCount), [index, floorCount]);
  const ref = useAnchor(`floor:${department.id}`, points, side === "left" ? "leftmost" : "rightmost", false);

  const counts = countByStatus(bots.map((b) => b.status));
  const parts = [`${bots.length} bot${bots.length === 1 ? "" : "s"}`];
  if (counts.working) parts.push(`${counts.working} working`);
  if (counts.waiting) parts.push(`${counts.waiting} waiting on you`);
  if (counts.error) parts.push(`${counts.error} error`);
  const focused = focusedFloorId === department.id;

  return (
    <div ref={ref} className="absolute top-0 left-0 will-change-transform" style={OFFSCREEN}>
      {/* The dot sits on the slab corner; the dashed line runs out to the boxed tag. */}
      <div
        className={cn(
          "flex -translate-y-1/2 items-center transition-opacity duration-300 animate-in fade-in duration-700",
          side === "left" ? "-translate-x-full" : "flex-row-reverse",
          dimmed && "opacity-30",
        )}
      >
        <span className="relative">
          <button
            type="button"
            onClick={() => focusFloor(focused ? null : department.id)}
            className={cn(
              "pointer-events-auto h-[30px] rounded-[6px] border-2 border-ink bg-panel px-3 font-mono text-[15px] whitespace-nowrap text-ink shadow-[0_2px_0_0_var(--lip)]",
              "hover:bg-honey focus-visible:outline-2 focus-visible:outline-ring",
              focused && "bg-honey",
            )}
          >
            {floorTag(department)}
          </button>
          <span
            className={cn(
              "absolute top-full mt-1.5 rounded-[6px] bg-panel/85 px-1.5 py-0.5 font-mono text-[12px] whitespace-nowrap text-ink",
              side === "left" ? "left-0" : "right-0",
            )}
          >
            {parts.join(", ")}
          </span>
        </span>
        <span className="h-0 w-8 border-t-2 border-dashed border-ink/60" />
        <span className="size-2.5 shrink-0 rounded-full border-2 border-ink bg-panel" />
      </div>
    </div>
  );
});
