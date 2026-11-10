import { useEffect, useMemo } from "react";
import { Color, DoubleSide, MeshStandardMaterial } from "three";
import type { FloorColors } from "@/lib/office/floors";

export type FloorMaterials = ReturnType<typeof createMaterials>;

function mat(color: string, opts: Partial<ConstructorParameters<typeof MeshStandardMaterial>[0]> = {}) {
  return new MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, ...opts });
}

/** Day: warm cream offices. Dusk (dark mode): dark floors, glowing monitors and softly lit glass. */
function createMaterials(colors: FloorColors, dusk: boolean) {
  const slab = dusk ? new Color(colors.slab).lerp(new Color("#2a2622"), 0.78).getStyle() : colors.slab;
  const slabSide = new Color(slab).multiplyScalar(dusk ? 0.7 : 0.82).getStyle();
  const glass = new Color(colors.glass);
  return {
    slabTop: mat(slab),
    slabSide: mat(slabSide),
    slabTrim: mat(colors.glass, { roughness: 0.6, emissive: dusk ? glass : new Color(0), emissiveIntensity: dusk ? 0.6 : 0 }),
    glass: mat(colors.glass, {
      transparent: true,
      opacity: GLASS_OPACITY(dusk),
      roughness: 0.1,
      depthWrite: false,
      side: DoubleSide,
      // At dusk the glass glows a little, like lit windows.
      emissive: dusk ? glass : new Color(0),
      emissiveIntensity: dusk ? 0.35 : 0,
    }),
    frame: mat(dusk ? "#5c574f" : "#f7f3ec", { roughness: 0.5 }),
    desk: mat(dusk ? "#4a453f" : "#f5f1e9", { roughness: 0.6 }),
    leg: mat(dusk ? "#3a3631" : "#b8b0a4"),
    monitor: mat(dusk ? "#1d2026" : "#3b3f47", { roughness: 0.4 }),
    screen: mat(colors.glass, { emissive: glass, emissiveIntensity: dusk ? 1.1 : 0.35, roughness: 0.3 }),
    stool: mat(dusk ? "#55504a" : "#ebe3d8"),
    plant: mat(dusk ? "#3f7032" : "#6ca445"),
    plantDark: mat(dusk ? "#30592a" : "#4f8a3a"),
    pot: mat(dusk ? "#8a5a3e" : "#c9825a"),
    dark: mat(dusk ? "#221f1b" : "#3a342d", { roughness: 0.7 }),
    rack: mat(dusk ? "#33373f" : "#525862", { roughness: 0.5, metalness: 0.15 }),
    wood: mat(dusk ? "#6a4e37" : "#a77b55"),
    paper: mat(dusk ? "#a59e93" : "#fbf8f2", { roughness: 0.9 }),
    noteA: mat("#f2c46d", { emissive: dusk ? new Color("#f2c46d") : new Color(0), emissiveIntensity: dusk ? 0.25 : 0 }),
    noteB: mat("#e891a0"),
    noteC: mat("#7fc79b"),
  };
}

const GLASS_OPACITY = (dusk: boolean) => (dusk ? 0.5 : 0.38);

/**
 * Sets every material's opacity from the floor's elevator fade (0–1) and focus dimming.
 * `transparent` only flips (forcing a shader update) when crossing fully-opaque.
 */
export function applyFloorOpacity(materials: FloorMaterials, fade: number, dimmed: boolean, dusk: boolean) {
  const factor = fade * (dimmed ? 0.22 : 1);
  for (const [name, m] of Object.entries(materials)) {
    const isGlass = name === "glass";
    const opacity = (isGlass ? GLASS_OPACITY(dusk) : 1) * factor;
    const transparent = isGlass || factor < 0.999;
    if (m.transparent !== transparent) {
      m.transparent = transparent;
      m.depthWrite = !transparent;
      m.needsUpdate = true;
    }
    m.opacity = opacity;
  }
}

/** Per-floor materials (opacity is driven per frame by the Floor's fade — see applyFloorOpacity). */
export function useFloorMaterials(colors: FloorColors, dusk = false) {
  const materials = useMemo(() => createMaterials(colors, dusk), [colors, dusk]);

  useEffect(() => () => Object.values(materials).forEach((m) => m.dispose()), [materials]);

  return materials;
}
