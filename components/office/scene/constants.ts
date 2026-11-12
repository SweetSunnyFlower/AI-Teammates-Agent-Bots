import { Box3, Vector3 } from "three";

// Building geometry (world units). Floors are "exploded" apart so every desk stays visible
// from the isometric camera, like the field-notes mockup.
export const FLOOR_W = 10.5; // x
export const FLOOR_D = 6.4; // z
export const SLAB_H = 0.32;
export const FLOOR_GAP = 3.6; // base-to-base: ~1 unit of air above the walls; desks stay visible from the default angle
export const WALL_H = 2.3;

/** Desk slots: back row then front row, left to right. */
export const DESK_SLOTS: Array<[number, number]> = [
  [-3.5, -1.1],
  [-1.15, -1.1],
  [1.15, -1.1],
  [3.5, -1.1],
  [-3.5, 1.5],
  [-1.15, 1.5],
  [1.15, 1.5],
  [3.5, 1.5],
];

/**
 * Default camera direction: facing the open front of the building (dollhouse view) with a
 * slight turn so it still reads as 3D. Azimuth is measured from +z, polar from straight up.
 */
const DEFAULT_AZIMUTH = 0.22; // ~13°
const DEFAULT_POLAR = 1.08; // ~62° from vertical → ~28° above the horizon
export const VIEW_DIR = new Vector3(
  Math.sin(DEFAULT_AZIMUTH) * Math.sin(DEFAULT_POLAR),
  Math.cos(DEFAULT_POLAR),
  Math.cos(DEFAULT_AZIMUTH) * Math.sin(DEFAULT_POLAR),
).normalize();
const SCREEN_RIGHT = new Vector3(VIEW_DIR.z, 0, -VIEW_DIR.x).normalize();
const SCREEN_UP = new Vector3(0, 1, 0).sub(VIEW_DIR.clone().multiplyScalar(VIEW_DIR.y)).normalize();

/** Avatars render at native size at this camera zoom and scale with zoom (clamped). */
export const AVATAR_REF_ZOOM = 30;

/** Floors stack up from the garden: the ground floor (lobby) sits at y = 0. */
export function floorBaseY(topDownIndex: number, floorCount: number) {
  return (floorCount - 1 - topDownIndex) * FLOOR_GAP;
}

/** Ground-floor-first index for a top-down index. */
export function bottomUpIndex(topDownIndex: number, floorCount: number) {
  return floorCount - 1 - topDownIndex;
}

/** Where a bot sits (stool position) — shared by the 3D rings and the DOM avatar overlay. */
export function botSeat(topDownIndex: number, floorCount: number, slot: number): [number, number, number] {
  const [x, z] = DESK_SLOTS[slot % DESK_SLOTS.length];
  return [x, floorBaseY(topDownIndex, floorCount), z + 0.72];
}

/** Avatars stand on the floor: their feet sit this far above the slab (the anchor is their bottom). */
export const AVATAR_LIFT = 0.08;
/** Avatar height in CSS px at scale 1 (incl. the status badge). */
export const AVATAR_PX = 50;
/** On screen, an avatar is never taller than this share of the room's wall height. */
export const AVATAR_ROOM_FIT = 0.75;

/** The four top corners of a floor slab; labels hang off the left- or right-most one on screen. */
export function floorCorners(topDownIndex: number, floorCount: number): Vector3[] {
  const y = floorBaseY(topDownIndex, floorCount) + 0.2;
  return [
    new Vector3(-FLOOR_W / 2, y, FLOOR_D / 2),
    new Vector3(FLOOR_W / 2, y, FLOOR_D / 2),
    new Vector3(FLOOR_W / 2, y, -FLOOR_D / 2),
    new Vector3(-FLOOR_W / 2, y, -FLOOR_D / 2),
  ];
}

/** Horizontal room the floating panels take on wide screens (left column + right column + gaps). */
export const PANEL_INSET = { left: 306, right: 360, top: 76, bottom: 64 };

export function floorBox(topDownIndex: number, floorCount: number) {
  const y = floorBaseY(topDownIndex, floorCount);
  return new Box3(
    new Vector3(-FLOOR_W / 2, y - SLAB_H, -FLOOR_D / 2),
    new Vector3(FLOOR_W / 2, y + WALL_H, FLOOR_D / 2),
  );
}

/** The elevator window: `visible` floors starting at ground-up index `elevator`. */
export function windowBox(elevator: number, visible: number, floorCount: number) {
  const lowest = floorCount - 1 - elevator; // top-down index of the lowest floor in view
  const highest = Math.max(lowest - visible + 1, 0);
  const box = floorBox(lowest, floorCount).union(floorBox(highest, floorCount));
  if (elevator === 0) box.min.y -= 0.6; // lobby: show a strip of garden under the ground floor
  return box;
}

export function buildingBox(floorCount: number) {
  const box = floorBox(0, floorCount);
  return box.union(floorBox(floorCount - 1, floorCount));
}

/** Orthographic zoom that fits `box` into a viewport, leaving room for floor labels. */
export function fitZoom(box: Box3, width: number, height: number, padX = 1.7, padY = 1.15) {
  const center = box.getCenter(new Vector3());
  let halfW = 0;
  let halfH = 0;
  const corner = new Vector3();
  for (let i = 0; i < 8; i++) {
    corner.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z);
    corner.sub(center);
    halfW = Math.max(halfW, Math.abs(corner.dot(SCREEN_RIGHT)));
    halfH = Math.max(halfH, Math.abs(corner.dot(SCREEN_UP)));
  }
  return Math.min(width / (2 * halfW * padX), height / (2 * halfH * padY));
}
