"use client";

import { useMemo } from "react";
import { CircleGeometry, ConeGeometry, CylinderGeometry, IcosahedronGeometry, MeshBasicMaterial, MeshStandardMaterial } from "three";
import { FLOOR_D, FLOOR_W } from "./constants";

// The green garden from dotty-home.jpg: an unlit lawn that matches the page's CSS green
// exactly, sandy paths, and low-poly trees. Geometry and materials are shared by every tree.

// Day matches --lawn in globals.css; dusk matches the .dark --lawn.
const PALETTE = {
  day: { lawn: "#8cc15d", patch: "#84b956", path: "#efd5a4", leaf: "#5fa046", leafDark: "#4e8c3b", trunk: "#8a5a3b" },
  dusk: { lawn: "#35592b", patch: "#30522a", path: "#6f6450", leaf: "#2f5a28", leafDark: "#264b21", trunk: "#4d3424" },
};

const TREES: Array<[number, number, number, "round" | "cone"]> = [
  [-11.5, -7, 1.25, "round"],
  [-14, 2.5, 1.05, "round"],
  [-10.5, 8.5, 0.9, "cone"],
  [11.5, -6.5, 1.15, "round"],
  [14.5, 1.5, 0.95, "cone"],
  [10.5, 9.5, 1.1, "round"],
  [-3.5, -12.5, 1.0, "round"],
  [5.5, -13, 0.85, "cone"],
  [-6.5, 14, 1.15, "round"],
  [7.5, 15, 0.9, "round"],
  [-18, -12, 1.2, "round"],
  [19, -11, 1.0, "round"],
  [-19, 12, 0.95, "cone"],
  [18, 13, 1.2, "round"],
];

const PATCHES: Array<[number, number, number]> = [
  [-9, 4, 3.2],
  [9.5, -3.5, 2.6],
  [-4, -10, 2.4],
  [13, 7, 3],
  [-15, -4, 2.8],
];

export function Garden({ groundY, dusk = false }: { groundY: number; dusk?: boolean }) {
  const c = dusk ? PALETTE.dusk : PALETTE.day;
  const r = useMemo(
    () => ({
      lawn: new MeshBasicMaterial({ color: c.lawn }),
      patch: new MeshBasicMaterial({ color: c.patch }),
      path: new MeshBasicMaterial({ color: c.path }),
      trunk: new MeshStandardMaterial({ color: c.trunk, roughness: 0.9 }),
      leaf: new MeshStandardMaterial({ color: c.leaf, roughness: 0.85, flatShading: true }),
      leafDark: new MeshStandardMaterial({ color: c.leafDark, roughness: 0.85, flatShading: true }),
      ground: new CircleGeometry(220, 48),
      patchGeo: new CircleGeometry(1, 24),
      trunkGeo: new CylinderGeometry(0.16, 0.22, 1.1, 8),
      roundGeo: new IcosahedronGeometry(1, 0),
      coneGeo: new ConeGeometry(0.95, 2.2, 7),
    }),
    [c],
  );

  return (
    <group position={[0, groundY, 0]}>
      <mesh geometry={r.ground} material={r.lawn} rotation-x={-Math.PI / 2} position={[0, -0.02, 0]} />
      {PATCHES.map(([x, z, s], i) => (
        <mesh key={i} geometry={r.patchGeo} material={r.patch} rotation-x={-Math.PI / 2} position={[x, -0.015, z]} scale={[s, s * 0.7, 1]} />
      ))}

      {/* Sandy plaza around the building and two paths leading away */}
      <mesh material={r.path} rotation-x={-Math.PI / 2} position={[0, -0.01, 0]}>
        <planeGeometry args={[FLOOR_W + 2.6, FLOOR_D + 2.6]} />
      </mesh>
      <mesh material={r.path} rotation={[-Math.PI / 2, 0, -Math.PI / 4]} position={[8.2, -0.012, 7.4]}>
        <planeGeometry args={[1.8, 16]} />
      </mesh>
      <mesh material={r.path} rotation={[-Math.PI / 2, 0, Math.PI / 5]} position={[-7.6, -0.012, 8.6]}>
        <planeGeometry args={[1.6, 14]} />
      </mesh>

      {TREES.map(([x, z, s, kind], i) => (
        <group key={i} position={[x, 0, z]} scale={s}>
          <mesh geometry={r.trunkGeo} material={r.trunk} position={[0, 0.55, 0]} />
          {kind === "round" ? (
            <>
              <mesh geometry={r.roundGeo} material={r.leaf} position={[0, 1.75, 0]} scale={1.05} />
              <mesh geometry={r.roundGeo} material={r.leafDark} position={[0.45, 1.45, 0.3]} scale={0.6} />
            </>
          ) : (
            <mesh geometry={r.coneGeo} material={r.leafDark} position={[0, 2.0, 0]} />
          )}
        </group>
      ))}
    </group>
  );
}
