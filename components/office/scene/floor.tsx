"use client";

import type { FloorColors } from "@/lib/office/floors";
import type { Bot, Department } from "@/lib/office/types";
import { useOffice } from "../office-provider";
import { BotRing } from "./bot-marker";
import { DESK_SLOTS, FLOOR_D, FLOOR_W, SLAB_H, WALL_H } from "./constants";
import { Bookshelf, Couch, Desk, MeetingTable, Plant, ServerRack, Whiteboard } from "./furniture";
import { applyFloorOpacity, useFloorMaterials, type FloorMaterials } from "./materials";
import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import type { Group } from "three";

const W2 = FLOOR_W / 2;
const D2 = FLOOR_D / 2;

export function Floor({
  department,
  bots,
  colors,
  baseY,
  detailed = true,
  shown = true,
  dimmed,
  dusk = false,
}: {
  department: Department;
  bots: Bot[];
  colors: FloorColors;
  baseY: number;
  /** False → plain slab + glass only (floors far from the elevator window). */
  detailed?: boolean;
  /** Elevator: false fades the floor out (it sits just above the window). */
  shown?: boolean;
  /** Dark mode: night materials. */
  dusk?: boolean;
  dimmed: boolean;
}) {
  const m = useFloorMaterials(colors, dusk);
  const group = useRef<Group>(null);
  const fade = useRef(0); // every floor eases in when it first appears
  const applied = useRef("");
  const invalidate = useThree((s) => s.invalidate);

  // Kick a frame whenever the target changes; the frame loop then animates until settled.
  useEffect(() => invalidate(), [shown, dimmed, dusk, m, invalidate]);

  useFrame((_, delta) => {
    const target = shown ? 1 : 0;
    const next = fade.current + (target - fade.current) * (1 - Math.exp(-delta * 7));
    fade.current = Math.abs(target - next) < 0.004 ? target : next;
    const key = `${fade.current.toFixed(3)}|${dimmed}|${dusk}`;
    if (key !== applied.current) {
      applied.current = key;
      applyFloorOpacity(m, fade.current, dimmed, dusk);
      if (group.current) {
        group.current.visible = fade.current > 0.01;
        // Glide down into place as it appears (and lift away as it leaves).
        group.current.position.y = baseY + (1 - fade.current) * 1.4;
      }
    }
    if (fade.current !== target) invalidate();
  });
  const { selectedBotId } = useOffice();

  return (
    <group ref={group} position={[0, baseY + 1.4, 0]} visible={false}>
      {/* Slab: cream top, darker sides, a colored trim line like the glass */}
      <mesh material={[m.slabSide, m.slabSide, m.slabTop, m.slabSide, m.slabSide, m.slabSide]} position={[0, -SLAB_H / 2, 0]}>
        <boxGeometry args={[FLOOR_W, SLAB_H, FLOOR_D]} />
      </mesh>
      <mesh material={m.slabTrim} position={[0, -SLAB_H + 0.04, D2 + 0.005]}>
        <boxGeometry args={[FLOOR_W, 0.08, 0.01]} />
      </mesh>
      <mesh material={m.slabTrim} position={[W2 + 0.005, -SLAB_H + 0.04, 0]}>
        <boxGeometry args={[0.01, 0.08, FLOOR_D]} />
      </mesh>

      <GlassWalls m={m} framed={detailed} />
      {detailed && <FloorProps kind={department.kind} m={m} />}

      {detailed && DESK_SLOTS.slice(0, Math.max(bots.length, 2)).map(([x, z], i) => (
        <Desk key={i} m={m} position={[x, 0, z]} accent={i % 2 === 0} />
      ))}
      {detailed && bots.slice(0, DESK_SLOTS.length).map((bot, i) => {
        const [x, z] = DESK_SLOTS[i];
        return (
          <BotRing key={bot.id} bot={bot} position={[x, 0, z + 0.72]} selected={selectedBotId === bot.id} dimmed={dimmed} />
        );
      })}

    </group>
  );
}

/** Colored glass on the two back sides, white mullions, and a short glass partition. */
function GlassWalls({ m, framed }: { m: FloorMaterials; framed: boolean }) {
  return (
    <group>
      <mesh material={m.glass} position={[0, WALL_H / 2, -D2]}>
        <boxGeometry args={[FLOOR_W, WALL_H, 0.06]} />
      </mesh>
      <mesh material={m.glass} position={[-W2, WALL_H / 2, 0]}>
        <boxGeometry args={[0.06, WALL_H, FLOOR_D]} />
      </mesh>
      {framed && (
        <>
          {/* partition between desk pods */}
          <mesh material={m.glass} position={[2.32, 0.75, -2.3]}>
            <boxGeometry args={[0.05, 1.5, 1.9]} />
          </mesh>
          <Mullions m={m} />
        </>
      )}
    </group>
  );
}

function Mullions({ m }: { m: FloorMaterials }) {
  const postsX = [-W2, -W2 / 2, 0, W2 / 2, W2];
  const postsZ = [-D2, 0, D2];
  return (
    <group>
      {postsX.map((x) => (
        <mesh key={`px${x}`} material={m.frame} position={[x, WALL_H / 2, -D2]}>
          <boxGeometry args={[0.08, WALL_H, 0.09]} />
        </mesh>
      ))}
      {postsZ.map((z) => (
        <mesh key={`pz${z}`} material={m.frame} position={[-W2, WALL_H / 2, z]}>
          <boxGeometry args={[0.09, WALL_H, 0.08]} />
        </mesh>
      ))}
      <mesh material={m.frame} position={[0, WALL_H, -D2]}>
        <boxGeometry args={[FLOOR_W, 0.08, 0.1]} />
      </mesh>
      <mesh material={m.frame} position={[-W2, WALL_H, 0]}>
        <boxGeometry args={[0.1, 0.08, FLOOR_D]} />
      </mesh>
      <mesh material={m.frame} position={[2.32, 1.5, -2.3]}>
        <boxGeometry args={[0.07, 0.06, 1.9]} />
      </mesh>
    </group>
  );
}

function FloorProps({ kind, m }: { kind: Department["kind"]; m: FloorMaterials }) {
  return (
    <group>
      <Plant m={m} position={[-W2 + 0.55, 0, -D2 + 0.55]} size={1.1} />
      <Plant m={m} position={[W2 - 0.5, 0, D2 - 0.5]} size={0.85} />
      {kind === "head" && (
        <>
          <Whiteboard m={m} position={[-2.2, 0, -D2 + 0.08]} />
          <MeetingTable m={m} position={[4.1, 0, -1.9]} />
        </>
      )}
      {kind === "assistant" && <Couch m={m} position={[4.2, 0, -2.3]} />}
      {kind === "research" && <Bookshelf m={m} position={[-W2 + 0.25, 0, 0.6]} rotation={Math.PI / 2} />}
      {kind === "engineering" && (
        <>
          <ServerRack m={m} position={[3.7, 0, -2.6]} />
          <ServerRack m={m} position={[4.55, 0, -2.6]} />
        </>
      )}
      {kind === "custom" && <Couch m={m} position={[4.2, 0, -2.3]} />}
    </group>
  );
}
