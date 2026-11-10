"use client";

import { STATUS_META } from "@/lib/office/status";
import type { Bot } from "@/lib/office/types";

/**
 * Status ring on the floor under a bot's stool. The avatar itself lives in the DOM overlay
 * (office-overlay.tsx), so this stays a cheap static mesh with no per-frame work.
 */
export function BotRing({
  bot,
  position,
  selected,
  dimmed,
}: {
  bot: Bot;
  position: [number, number, number];
  selected: boolean;
  dimmed: boolean;
}) {
  const color = STATUS_META[bot.status].color;
  return (
    <group position={position}>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.015, 0]} scale={selected ? 1.25 : 1}>
        <ringGeometry args={[0.42, 0.56, 40]} />
        <meshBasicMaterial color={color} transparent opacity={dimmed ? 0.15 : 0.95} depthWrite={false} />
      </mesh>
      {selected && (
        <mesh rotation-x={-Math.PI / 2} position={[0, 0.01, 0]}>
          <circleGeometry args={[0.8, 40]} />
          <meshBasicMaterial color="#f0dab1" transparent opacity={0.85} depthWrite={false} />
        </mesh>
      )}
    </group>
  );
}
