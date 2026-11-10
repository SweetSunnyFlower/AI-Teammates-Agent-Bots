"use client";

import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { CameraControls, CameraControlsImpl, ContactShadows, OrthographicCamera } from "@react-three/drei";
import { Matrix4, Vector3, type OrthographicCamera as OrthoCam } from "three";
import { useTheme } from "next-themes";
import { floorColors } from "@/lib/office/floors";
import { useOffice, VISIBLE_FLOORS } from "../office-provider";
import {
  AVATAR_REF_ZOOM,
  bottomUpIndex,
  fitZoom,
  floorBaseY,
  windowBox,
  FLOOR_GAP,
  VIEW_DIR,
  PANEL_INSET,
  SLAB_H,
} from "./constants";
import { Floor } from "./floor";
import { Garden } from "./garden";

const { ACTION } = CameraControlsImpl;
const CAMERA_DISTANCE = 80;

export default function OfficeCanvas() {
  return (
    <Canvas
      flat
      frameloop="demand"
      dpr={[1, 1.5]}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      className="absolute! inset-0"
      aria-label="3D office building"
    >
      <OrthographicCamera makeDefault position={VIEW_DIR.clone().multiplyScalar(CAMERA_DISTANCE).toArray()} zoom={20} near={0.1} far={500} />
      <Controls />
      <CameraRig />
      <OverlayProjector />

      <Lights />
      <Building />
    </Canvas>
  );
}

/** Daylight, or a softer moonlit dusk where the glass offices glow (dark mode). */
function Lights() {
  const dusk = useTheme().resolvedTheme === "dark";
  return dusk ? (
    <>
      <hemisphereLight args={["#c9d4ff", "#2c3f26", 0.9]} />
      <directionalLight position={[-6, 14, 9]} intensity={0.8} color="#cdd8ff" />
      <directionalLight position={[8, 6, -4]} intensity={0.45} color="#ffd9a0" />
    </>
  ) : (
    <>
      <hemisphereLight args={["#fffaf0", "#b9cf9a", 1.6]} />
      <directionalLight position={[-6, 14, 9]} intensity={1.5} />
      <directionalLight position={[8, 6, -4]} intensity={0.35} />
    </>
  );
}

function Building() {
  const { floors, botsByFloor, departmentById, focusedFloorId, elevator } = useOffice();
  const dusk = useTheme().resolvedTheme === "dark";
  const departments = useMemo(() => [...departmentById.values()], [departmentById]);
  const n = floors.length;
  const groundY = floorBaseY(n - 1, n) - SLAB_H;

  return (
    <group>
      <Garden groundY={groundY} dusk={dusk} />
      {floors.map((dept, i) => {
        // Elevator window: floors above it aren't drawn at all (they appear as you ride up).
        // Floors below stay so the building still stands on the garden — full detail for the
        // one just below the window, plain slabs further down.
        // The floor just above the window stays mounted (faded out) so riding cross-fades smoothly.
        const b = bottomUpIndex(i, n);
        if (b > elevator + VISIBLE_FLOORS) return null;
        const shown = b < elevator + VISIBLE_FLOORS;
        const detailed = b >= elevator - 1;
        return (
          <Floor
            key={dept.id}
            department={dept}
            bots={botsByFloor.get(dept.id) ?? []}
            colors={floorColors(departments, dept.id)}
            baseY={floorBaseY(i, n)}
            detailed={detailed}
            shown={shown}
            dusk={dusk}
            dimmed={focusedFloorId !== null && focusedFloorId !== dept.id}
          />
        );
      })}
      <ContactShadows position={[0, groundY + 0.01, 0]} scale={24} opacity={0.3} blur={2.6} far={FLOOR_GAP} frames={1} color={dusk ? "#0d1a0a" : "#2f4d1c"} />
    </group>
  );
}

/** Left-drag rotates around the building, right-drag pans, wheel/pinch zooms. */
function Controls() {
  const { controlsRef } = useOffice();
  return (
    <CameraControls
      ref={controlsRef}
      makeDefault
      minZoom={6}
      maxZoom={160}
      minPolarAngle={0.3}
      maxPolarAngle={1.32}
      smoothTime={0.3}
      draggingSmoothTime={0.12}
      mouseButtons={{ left: ACTION.ROTATE, middle: ACTION.TRUCK, right: ACTION.TRUCK, wheel: ACTION.ZOOM }}
      touches={{ one: ACTION.TOUCH_ROTATE, two: ACTION.TOUCH_ZOOM_TRUCK, three: ACTION.TOUCH_TRUCK }}
    />
  );
}

/**
 * Elevator camera: frames a window of up to four floors. Riding up/down glides the target while
 * keeping the user's rotation; the lobby resets to the default front-facing angle.
 */
function CameraRig() {
  const { floors, elevator, lobbyNonce } = useOffice();
  const controls = useThree((s) => s.controls) as CameraControlsImpl | null;
  const size = useThree((s) => s.size);
  const first = useRef(true);
  const lastLobby = useRef(lobbyNonce);
  const n = floors.length;

  useEffect(() => {
    if (!controls || size.width === 0 || size.height === 0 || n === 0) return;

    // On wide screens the panels float over the scene, so fit into the space between them.
    const wide = size.width >= 1024;
    const w = wide ? size.width - PANEL_INSET.left - PANEL_INSET.right : size.width;
    const h = wide ? size.height - PANEL_INSET.top - PANEL_INSET.bottom : size.height;

    // Zoom is fitted to a full window (not the current one) so riding never changes scale.
    const fitBox = windowBox(0, Math.min(VISIBLE_FLOORS, n), n);
    const box = windowBox(elevator, Math.min(VISIBLE_FLOORS, n), n);
    const center = box.getCenter(new Vector3());
    const zoom = fitZoom(fitBox, w, h, 1.85, 1.22);
    const shiftPx = wide ? (PANEL_INSET.right - PANEL_INSET.left) / 2 : 0;
    const shiftDownPx = wide ? (PANEL_INSET.top - PANEL_INSET.bottom) / 2 : 0;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const animate = !first.current && !reduceMotion;
    const resetAngle = first.current || lastLobby.current !== lobbyNonce;
    lastLobby.current = lobbyNonce;

    if (resetAngle) {
      const pos = center.clone().add(VIEW_DIR.clone().multiplyScalar(CAMERA_DISTANCE));
      void controls.setLookAt(pos.x, pos.y, pos.z, center.x, center.y, center.z, animate);
    } else {
      void controls.moveTo(center.x, center.y, center.z, animate);
    }
    void controls.zoomTo(zoom, animate);
    void controls.setFocalOffset(shiftPx / zoom, shiftDownPx / zoom, 0, animate);
    first.current = false;
  }, [controls, elevator, lobbyNonce, n, size.width, size.height]);

  return null;
}

/**
 * Positions every DOM overlay anchor (avatars, floor labels) in one pass. Runs only on frames
 * that actually render (frameloop="demand"), and skips work when the camera hasn't changed.
 */
function OverlayProjector() {
  const { anchorsRef, requestFrameRef } = useOffice();
  const invalidate = useThree((s) => s.invalidate);
  const v = useMemo(() => new Vector3(), []);
  const last = useMemo(() => ({ view: new Matrix4(), w: 0, h: 0, count: -1, zoom: 0 }), []);

  useEffect(() => {
    requestFrameRef.current = () => {
      last.count = -1; // force a reposition on the next frame
      invalidate();
    };
    invalidate();
    return () => {
      requestFrameRef.current = null;
    };
  }, [invalidate, requestFrameRef, last]);

  useFrame(({ camera, size }) => {
    const cam = camera as OrthoCam;
    cam.updateMatrixWorld(); // controls moved the camera this frame; keep projection in sync
    const anchors = anchorsRef.current;
    if (
      last.count === anchors.size &&
      last.w === size.width &&
      last.h === size.height &&
      last.zoom === cam.zoom &&
      last.view.equals(cam.matrixWorldInverse)
    ) {
      return;
    }
    last.view.copy(cam.matrixWorldInverse);
    last.w = size.width;
    last.h = size.height;
    last.zoom = cam.zoom;
    last.count = anchors.size;

    const scale = Math.min(Math.max(cam.zoom / AVATAR_REF_ZOOM, 0.55), 2.2).toFixed(3);
    for (const a of anchors.values()) {
      let bestX = 0;
      let bestY = 0;
      let bestScore = Number.POSITIVE_INFINITY;
      for (const p of a.points) {
        v.copy(p).project(cam);
        const x = ((v.x + 1) / 2) * size.width;
        const y = ((1 - v.y) / 2) * size.height;
        const score = a.mode === "rightmost" ? -x : a.mode === "leftmost" ? x : 0;
        if (score < bestScore) {
          bestScore = score;
          bestX = x;
          bestY = y;
        }
        if (a.mode === "point") break;
      }
      a.el.style.transform = `translate3d(${bestX.toFixed(1)}px, ${bestY.toFixed(1)}px, 0)${a.scaleWithZoom ? ` scale(${scale})` : ""}`;
    }
  });

  return null;
}
