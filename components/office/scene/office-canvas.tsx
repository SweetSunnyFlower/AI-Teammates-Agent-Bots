"use client";

import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Loader2, RotateCw } from "lucide-react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { CameraControls, CameraControlsImpl, ContactShadows, OrthographicCamera } from "@react-three/drei";
import { Matrix4, Vector3, type OrthographicCamera as OrthoCam } from "three";
import { useTheme } from "next-themes";
import { floorColors } from "@/lib/office/floors";
import { anyMoving, applyMotion, setMotionWake } from "../motion";
import { useOffice, VISIBLE_FLOORS } from "../office-provider";
import {
  AVATAR_PX,
  AVATAR_REF_ZOOM,
  AVATAR_ROOM_FIT,
  WALL_H,
  bottomUpIndex,
  fitZoom,
  floorBaseY,
  floorBox,
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
/** How much closer a focused floor sits than the fitted view. */
const FOCUS_ZOOM = 1.9;

/**
 * The 3D office, self-healing: if the WebGL canvas comes back broken — context lost and not
 * restored (switching apps, GPU pressure, sleep), or the page was hidden and shown again by
 * React/Next.js (<Activity>) — it is rebuilt from scratch (new key) instead of staying blank.
 */
export default function OfficeCanvas() {
  const [generation, setGeneration] = useState(0);
  // "loading" until the first frame is drawn; "failed" after too many rebuilds (or no WebGL).
  const [status, setStatus] = useState<"loading" | "rebuilding" | "ready" | "failed">("loading");
  const recentRebuilds = useRef<number[]>([]);
  const rebuild = useCallback(() => {
    // At most 3 automatic rebuilds per 30s, so a machine where WebGL keeps failing doesn't loop —
    // then we say so and offer a button instead of a blank screen.
    const now = Date.now();
    recentRebuilds.current = recentRebuilds.current.filter((t) => now - t < 30000);
    if (recentRebuilds.current.length >= 3) {
      setStatus("failed");
      return;
    }
    recentRebuilds.current.push(now);
    setStatus((s) => (s === "loading" ? s : "rebuilding"));
    setGeneration((g) => g + 1);
  }, []);
  /** Manual "Reload 3D" (and coming back to the tab after a failure): a fresh set of tries. */
  const retry = useCallback(() => {
    recentRebuilds.current = [];
    rebuild();
  }, [rebuild]);

  useEffect(() => {
    if (status !== "failed") return;
    const onVisible = () => document.visibilityState === "visible" && retry();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [status, retry]);

  // Effects re-run when a hidden page is shown again; the old WebGL scene may be gone → rebuild.
  const shownBefore = useRef(false);
  useEffect(() => {
    if (!shownBefore.current) {
      shownBefore.current = true;
      return;
    }
    const frame = window.requestAnimationFrame(rebuild);
    return () => window.cancelAnimationFrame(frame);
  }, [rebuild]);

  return (
    <>
      {status !== "failed" && (
        <CanvasBoundary key={generation} onError={() => setStatus("failed")}>
          <Canvas
            flat
            frameloop="demand"
            dpr={[1, 1.5]}
            gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
            className="absolute! inset-0"
            aria-label="3D office building"
            // Ready once the first frame is on screen.
            onCreated={() => window.requestAnimationFrame(() => window.requestAnimationFrame(() => setStatus("ready")))}
          >
            <OrthographicCamera makeDefault position={VIEW_DIR.clone().multiplyScalar(CAMERA_DISTANCE).toArray()} zoom={20} near={0.1} far={500} />
            <Controls />
            <CameraRig />
            <OverlayProjector />
            <FrameKeeper onBroken={rebuild} />
            <ContextRelease />

            <Lights />
            <Building />
          </Canvas>
        </CanvasBoundary>
      )}
      <CanvasStatus status={status} onRetry={retry} />
    </>
  );
}

/**
 * Hands the WebGL context back when this canvas goes away (navigating to Boards, a rebuild).
 * Browsers allow only about 16 live contexts and reclaim them lazily, so without this a few
 * navigations are enough for the browser to kill the newest canvas and leave the office blank.
 */
function ContextRelease() {
  const gl = useThree((s) => s.gl);
  useEffect(
    () => () => {
      try {
        gl.forceContextLoss();
      } catch {
        // Already gone — nothing to release.
      }
      gl.dispose();
    },
    [gl],
  );
  return null;
}

/** Loading / rebuilding / failed states over the 3D view — never a silent blank. */
function CanvasStatus({ status, onRetry }: { status: "loading" | "rebuilding" | "ready" | "failed"; onRetry: () => void }) {
  if (status === "ready") return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center">
      {status === "failed" ? (
        <div role="alert" className="fn-panel pointer-events-auto flex max-w-75 flex-col items-center gap-2 px-5 py-4 text-center">
          <p className="text-[15px] font-bold text-ink">The 3D view stopped</p>
          <p className="text-[13px] leading-snug text-ink/75">
            Your browser dropped the 3D graphics (this can happen after switching apps or sleep). Your bots keep working.
          </p>
          <button type="button" onClick={onRetry} className="fn-sticker mt-1 h-9 gap-1.5 px-3 text-[13.5px]">
            <RotateCw className="size-3.5" /> Reload 3D
          </button>
        </div>
      ) : (
        <p role="status" className="fn-pill flex items-center gap-2 bg-panel/90 px-3 py-1.5 font-mono text-[12.5px] text-ink">
          <Loader2 className="size-3.5 animate-spin" />
          {status === "loading" ? "building the office…" : "rebuilding the office…"}
        </p>
      )}
    </div>
  );
}

/** If WebGL can't start at all, R3F throws — show the "failed" card instead of crashing the page. */
class CanvasBoundary extends Component<{ children: ReactNode; onError: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.warn("[office] 3D view failed", error);
    this.props.onError();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
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

/**
 * With frameloop="demand" the scene only redraws when asked. If the browser wipes the canvas
 * (tab hidden, GPU context lost/restored, a refresh landing between frames) nothing asks again
 * and the office shows blank until the mouse moves. This keeps it drawn:
 *   - redraw on visibility/focus/resize and after a WebGL context is restored
 *   - redraw whenever office data changes (Realtime refreshes)
 *   - a cheap safety redraw every 2s while the page is visible
 */
function FrameKeeper({ onBroken }: { onBroken: () => void }) {
  const invalidate = useThree((s) => s.invalidate);
  const gl = useThree((s) => s.gl);
  const { snapshot, floors, elevator } = useOffice();

  useEffect(() => {
    const canvas = gl.domElement;
    const context = gl.getContext();
    let restoreTimer: number | undefined;

    // A dead context can't draw anything: rebuild the whole canvas.
    const healthy = () => {
      if (context.isContextLost()) {
        onBroken();
        return false;
      }
      return true;
    };
    const kick = () => {
      if (document.visibilityState !== "visible" || !healthy()) return;
      invalidate();
      window.requestAnimationFrame(() => invalidate()); // and once more after layout settles
    };
    const onLost = (e: Event) => {
      e.preventDefault(); // lets the browser try to restore it…
      window.clearTimeout(restoreTimer);
      restoreTimer = window.setTimeout(() => context.isContextLost() && onBroken(), 2000); // …or we rebuild
    };
    const onRestored = () => {
      window.clearTimeout(restoreTimer);
      // three.js re-inits, but uploaded geometry/materials can be gone — rebuild to be safe.
      onBroken();
    };
    canvas.addEventListener("webglcontextlost", onLost);
    canvas.addEventListener("webglcontextrestored", onRestored);
    document.addEventListener("visibilitychange", kick);
    window.addEventListener("focus", kick);
    window.addEventListener("pageshow", kick);
    window.addEventListener("resize", kick);
    const heartbeat = window.setInterval(() => {
      if (document.visibilityState === "visible" && healthy()) invalidate();
    }, 2000);
    return () => {
      window.clearTimeout(restoreTimer);
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
      document.removeEventListener("visibilitychange", kick);
      window.removeEventListener("focus", kick);
      window.removeEventListener("pageshow", kick);
      window.removeEventListener("resize", kick);
      window.clearInterval(heartbeat);
    };
  }, [gl, invalidate, onBroken]);

  // New data from the server (Realtime → router.refresh) → draw it.
  useEffect(() => invalidate(), [snapshot, floors, elevator, invalidate]);

  return null;
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
  const { floors, elevator, lobbyNonce, focusedFloorId } = useOffice();
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
    const fitted = fitZoom(fitBox, w, h, 1.85, 1.22);
    // A focused floor gets a gentle push-in and sits in the middle of the view, with the other
    // floors dimmed by <Floor dimmed>. Modest on purpose: clicking a bot slides the drawer open at
    // the same moment, and two big movements at once fight each other.
    const focusIndex = focusedFloorId ? floors.findIndex((f) => f.id === focusedFloorId) : -1;
    const center = (focusIndex >= 0 ? floorBox(focusIndex, n) : box).getCenter(new Vector3());
    const zoom = focusIndex >= 0 ? fitted * FOCUS_ZOOM : fitted;
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
  }, [controls, elevator, focusedFloorId, floors, lobbyNonce, n, size.width, size.height]);

  return null;
}

/**
 * Positions every DOM overlay anchor (avatars, floor labels) in one pass. Runs only on frames
 * that actually render (frameloop="demand"), and skips work when the camera hasn't changed.
 */
function OverlayProjector() {
  const { anchorsRef, requestFrameRef } = useOffice();
  const invalidate = useThree((s) => s.invalidate);
  // Scratch state lives in refs (mutated per frame, never during render).
  const vRef = useRef(new Vector3());
  const walkRef = useRef(new Vector3());
  const dirRef = useRef(new Vector3());
  const lastRef = useRef({ view: new Matrix4(), w: 0, h: 0, count: -1, zoom: 0, moving: false });

  useEffect(() => {
    const force = () => {
      lastRef.current.count = -1; // force a reposition on the next frame
      invalidate();
    };
    requestFrameRef.current = force;
    setMotionWake(force); // a bot started walking
    invalidate();
    return () => {
      requestFrameRef.current = null;
      setMotionWake(null);
    };
  }, [invalidate, requestFrameRef]);

  useFrame(({ camera, size }) => {
    const cam = camera as OrthoCam;
    cam.updateMatrixWorld(); // controls moved the camera this frame; keep projection in sync
    const anchors = anchorsRef.current;
    const last = lastRef.current;
    const v = vRef.current;
    const now = performance.now();
    const moving = anyMoving(now);
    if (
      !moving &&
      !last.moving &&
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
    last.moving = moving;

    // Avatars scale with zoom, but never grow taller than the room looks on screen (zoomed out,
    // or tilted towards a top-down view) — so heads stay inside their floor.
    cam.getWorldDirection(dirRef.current);
    const tilt = Math.sqrt(Math.max(0, 1 - dirRef.current.y ** 2)); // 1 = side view, 0 = top-down
    const roomPx = WALL_H * AVATAR_ROOM_FIT * cam.zoom * tilt;
    const scale = Math.max(0.25, Math.min(cam.zoom / AVATAR_REF_ZOOM, 2.2, roomPx / AVATAR_PX)).toFixed(3);
    for (const a of anchors.values()) {
      let bestX = 0;
      let bestY = 0;
      let bestScore = Number.POSITIVE_INFINITY;
      let walking = false;
      for (const p of a.points) {
        if (a.motionKey) {
          walking = applyMotion(a.motionKey, p, walkRef.current, now);
          v.copy(walkRef.current).project(cam);
        } else v.copy(p).project(cam);
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
      if (a.motionKey && (a.el.dataset.walking === "1") !== walking) a.el.dataset.walking = walking ? "1" : "";
    }
    if (moving) invalidate(); // keep drawing until every walk has finished
  });

  return null;
}
