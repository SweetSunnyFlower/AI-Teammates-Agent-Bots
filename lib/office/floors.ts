import type { Department } from "./types";

/**
 * Colored-glass palette per floor, taken from top floor down (DESIGN.md §2 "Floor glass").
 * `glass` tints the translucent walls, `slab` is the warm cream floor with a hint of the glass,
 * `chip` is the 2D tint used for floor badges and labels in panels.
 */
export const FLOOR_PALETTE = [
  { name: "sky", glass: "#7fb3e3", slab: "#ece6dc", chip: "#d6e6f3" },
  { name: "apricot", glass: "#f2a766", slab: "#efe5d6", chip: "#f6dfc6" },
  { name: "mint", glass: "#7fc79b", slab: "#e8e8da", chip: "#d6ecdc" },
  { name: "lavender", glass: "#a99be6", slab: "#ebe5e6", chip: "#e2dcf3" },
  { name: "butter", glass: "#e8c25a", slab: "#eee7d4", chip: "#f3e7c1" },
  { name: "rose", glass: "#e891a0", slab: "#eee3e0", chip: "#f4d9dd" },
] as const;

export interface FloorColors {
  glass: string;
  slab: string;
  chip: string;
}

/** Tints offered in the floor dialog (the glass colour; slab and chip are derived from it). */
export const FLOOR_TINTS = [
  "#7fb3e3",
  "#f2a766",
  "#7fc79b",
  "#a99be6",
  "#e8c25a",
  "#e891a0",
  "#5fc4c0",
  "#d98b6a",
] as const;

/** Departments sorted top floor first. */
export function floorsTopDown(departments: Department[]) {
  return [...departments].sort((a, b) => b.floorIndex - a.floorIndex);
}

// Derived palettes are cached by hex so 3D materials keyed on the object aren't rebuilt each render.
const derived = new Map<string, FloorColors>();

function mix(a: string, b: string, t: number) {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return `#${pa.map((v, i) => Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, "0")).join("")}`;
}

/** Glass/slab/chip colours for a tint: palette values when it's a known tint, otherwise mixed. */
export function colorsForTint(hex: string): FloorColors {
  const key = hex.toLowerCase();
  const cached = derived.get(key);
  if (cached) return cached;
  const known = FLOOR_PALETTE.find((p) => p.glass === key);
  const colors = known
    ? { glass: known.glass, slab: known.slab, chip: known.chip }
    : { glass: key, slab: mix("#efe8dc", key, 0.1), chip: mix("#ffffff", key, 0.32) };
  derived.set(key, colors);
  return colors;
}

/** A department's colours: its chosen tint, or the palette by position (top floor first). */
export function floorColors(departments: Department[], departmentId: string): FloorColors {
  const dept = departments.find((d) => d.id === departmentId);
  if (dept?.color) return colorsForTint(dept.color);
  const order = floorsTopDown(departments).findIndex((d) => d.id === departmentId);
  return colorsForTint(FLOOR_PALETTE[Math.max(order, 0) % FLOOR_PALETTE.length].glass);
}

/** The tint a floor currently shows (chosen or positional) — used to prefill the dialog. */
export function floorTint(departments: Department[], departmentId: string) {
  return floorColors(departments, departmentId).glass;
}

export function floorTag(d: Department) {
  return `${d.floorIndex}F · ${d.name.toLowerCase()}`;
}
