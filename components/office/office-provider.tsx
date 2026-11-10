"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import type { CameraControlsImpl } from "@react-three/drei";
import type { Vector3 } from "three";
import { floorsTopDown } from "@/lib/office/floors";
import type { Bot, Department, InboxItem, OfficeSnapshot } from "@/lib/office/types";

export type DrawerTab = "chat" | "activity" | "routines" | "setup";

/**
 * A DOM element (avatar or floor label) pinned to 3D points. The canvas projects every
 * anchor in one pass per rendered frame, so there is no per-avatar React root or portal.
 */
export interface OverlayAnchor {
  el: HTMLElement;
  points: Vector3[];
  /** "point" uses points[0]; the others pick the on-screen left- or right-most point. */
  mode: "point" | "leftmost" | "rightmost";
  scaleWithZoom: boolean;
}

/** What the team dialogs are editing (undefined id = create). */
export type Editor =
  | { type: "bot"; botId?: string; departmentId?: string }
  | { type: "department"; departmentId?: string }
  | null;

/** The elevator shows this many floors at a time. */
export const VISIBLE_FLOORS = 5;

/** Sections the top bar can scroll to (and expand). */
export type RevealSection = "waiting" | "routines";

interface OfficeState {
  snapshot: OfficeSnapshot;
  floors: Department[];
  botsByFloor: Map<string, Bot[]>;
  botById: Map<string, Bot>;
  departmentById: Map<string, Department>;

  selectedBotId: string | null;
  drawerTab: DrawerTab;
  selectBot: (botId: string | null, tab?: DrawerTab) => void;
  setDrawerTab: (tab: DrawerTab) => void;

  focusedFloorId: string | null;
  /** Highlights a floor and rides the elevator straight to it (null clears the highlight). */
  focusFloor: (departmentId: string | null) => void;

  /** Elevator: index (ground floor = 0) of the lowest floor in view; 0 = lobby. */
  elevator: number;
  maxElevator: number;
  moveElevator: (delta: number) => void;
  /** Back to the ground floor and the default camera angle. */
  goLobby: () => void;
  /** Bumped by goLobby so the camera knows to reset its angle. */
  lobbyNonce: number;

  /** False for the demo office (no database) — editing controls are hidden. */
  canEdit: boolean;
  editor: Editor;
  openEditor: (editor: Editor) => void;

  /** A message waiting to be sent by a bot's chat once it opens (from "Ask the Head"). */
  pendingAsk: { botId: string; text: string; nonce: number } | null;
  /** Open a bot's chat and send `text` there. */
  askBot: (botId: string, text: string) => void;
  clearPendingAsk: () => void;

  cleanView: boolean;
  toggleCleanView: () => void;
  touring: boolean;
  toggleTour: () => void;

  controlsRef: RefObject<CameraControlsImpl | null>;
  zoomBy: (factor: number) => void;

  decideInbox: (item: InboxItem, decision: "approve" | "skip") => void;

  anchorsRef: RefObject<Map<string, OverlayAnchor>>;
  registerAnchor: (id: string, anchor: OverlayAnchor | null) => void;
  /** Set by the canvas: asks for one frame (the canvas renders on demand). */
  requestFrameRef: RefObject<(() => void) | null>;

  reveal: { section: RevealSection; nonce: number } | null;
  revealSection: (section: RevealSection) => void;
}

const OfficeContext = createContext<OfficeState | null>(null);

export function useOffice() {
  const ctx = useContext(OfficeContext);
  if (!ctx) throw new Error("useOffice must be used inside <OfficeProvider>");
  return ctx;
}

const TOUR_STEP_MS = 3500;

export function OfficeProvider({
  initialSnapshot,
  children,
}: {
  initialSnapshot: OfficeSnapshot;
  children: ReactNode;
}) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  // After a save, router.refresh() hands us a new server snapshot — adopt it (keep UI state).
  const [source, setSource] = useState(initialSnapshot);
  if (source !== initialSnapshot) {
    setSource(initialSnapshot);
    setSnapshot(initialSnapshot);
  }
  const [editor, openEditor] = useState<Editor>(null);
  const [pendingAsk, setPendingAsk] = useState<OfficeState["pendingAsk"]>(null);
  const [elevator, setElevator] = useState(0);
  const [lobbyNonce, setLobbyNonce] = useState(0);
  const canEdit = snapshot.workspace.id !== "demo";
  const [selectedBotId, setSelectedBotId] = useState<string | null>(null);
  const [drawerTab, setDrawerTab] = useState<DrawerTab>("activity");
  const [focusedFloorId, setFocusedFloorId] = useState<string | null>(null);
  const [cleanView, setCleanView] = useState(false);
  const [touring, setTouring] = useState(false);
  const controlsRef = useRef<CameraControlsImpl | null>(null);
  const anchorsRef = useRef(new Map<string, OverlayAnchor>());
  const requestFrameRef = useRef<(() => void) | null>(null);
  const [reveal, setReveal] = useState<{ section: RevealSection; nonce: number } | null>(null);

  const registerAnchor = useCallback((id: string, anchor: OverlayAnchor | null) => {
    if (anchor) anchorsRef.current.set(id, anchor);
    else anchorsRef.current.delete(id);
    requestFrameRef.current?.();
  }, []);

  const revealSection = useCallback((section: RevealSection) => {
    setReveal({ section, nonce: Date.now() });
  }, []);

  const floors = useMemo(() => floorsTopDown(snapshot.departments), [snapshot.departments]);

  const { botsByFloor, botById, departmentById } = useMemo(() => {
    const byFloor = new Map<string, Bot[]>();
    for (const d of snapshot.departments) byFloor.set(d.id, []);
    for (const b of snapshot.bots) byFloor.get(b.departmentId)?.push(b);
    // Head/lead first so they get the front desks.
    const rank = { head: 0, lead: 1, worker: 2 } as const;
    for (const list of byFloor.values()) list.sort((a, b) => rank[a.role] - rank[b.role]);
    return {
      botsByFloor: byFloor,
      botById: new Map(snapshot.bots.map((b) => [b.id, b])),
      departmentById: new Map(snapshot.departments.map((d) => [d.id, d])),
    };
  }, [snapshot.bots, snapshot.departments]);

  const selectBot = useCallback((botId: string | null, tab?: DrawerTab) => {
    setSelectedBotId(botId);
    if (tab) setDrawerTab(tab);
  }, []);

  const maxElevator = Math.max(0, floors.length - VISIBLE_FLOORS);
  const clampElevator = useCallback((v: number) => Math.min(Math.max(v, 0), maxElevator), [maxElevator]);

  /** Ride to a floor so it sits second from the bottom of the window (or as close as possible). */
  const rideTo = useCallback(
    (departmentId: string) => {
      const bottomUp = floors.length - 1 - floors.findIndex((f) => f.id === departmentId);
      setElevator(clampElevator(bottomUp - 1));
    },
    [floors, clampElevator],
  );

  const focusFloor = useCallback(
    (departmentId: string | null) => {
      setTouring(false);
      setFocusedFloorId(departmentId);
      if (departmentId) rideTo(departmentId);
    },
    [rideTo],
  );

  const moveElevator = useCallback(
    (delta: number) => {
      setTouring(false);
      setFocusedFloorId(null);
      setElevator((e) => clampElevator(e + delta));
    },
    [clampElevator],
  );

  const goLobby = useCallback(() => {
    setTouring(false);
    setFocusedFloorId(null);
    setElevator(0);
    setLobbyNonce((n) => n + 1);
  }, []);

  // Floors were added/removed: keep the elevator inside the building.
  if (elevator > maxElevator) setElevator(maxElevator);

  const toggleTour = useCallback(() => setTouring((t) => !t), []);
  const toggleCleanView = useCallback(() => setCleanView((c) => !c), []);

  const zoomBy = useCallback((factor: number) => {
    const controls = controlsRef.current;
    if (!controls) return;
    const camera = controls.camera as { zoom: number };
    controls.zoomTo(camera.zoom * factor, true);
  }, []);

  // Mock decision: removes the inbox item and wakes the bot. Replaced by the
  // server action that completes the Trigger.dev waitpoint in Phase 3.
  const decideInbox = useCallback((item: InboxItem, decision: "approve" | "skip") => {
    setSnapshot((s) => ({
      ...s,
      inbox: s.inbox.filter((i) => i.id !== item.id),
      bots: s.bots.map((b) =>
        b.id === item.botId
          ? {
              ...b,
              status: decision === "approve" ? "working" : "resting",
              statusDetail: decision === "approve" ? `Approved: ${item.title}` : "Resting",
              lastActive: "now",
            }
          : b,
      ),
      activity: [
        {
          id: `local-${item.id}`,
          time: "now",
          botId: item.botId,
          text: decision === "approve" ? `got your approval for “${item.title}”` : `was told to skip “${item.title}”`,
        },
        ...s.activity,
      ],
    }));
  }, []);

  // Tour: ride from the top floor down, highlighting each, then back to the lobby.
  useEffect(() => {
    if (!touring) return;
    const stops = floors.map((f) => f.id);
    let i = 0;
    const visit = (id: string) => {
      setFocusedFloorId(id);
      rideTo(id);
    };
    visit(stops[0]);
    const timer = window.setInterval(() => {
      i += 1;
      if (i >= stops.length) {
        setTouring(false);
        setFocusedFloorId(null);
        setElevator(0);
        return;
      }
      visit(stops[i]);
    }, TOUR_STEP_MS);
    return () => window.clearInterval(timer);
  }, [touring, floors, rideTo]);

  const askBot = useCallback((botId: string, text: string) => {
    setSelectedBotId(botId);
    setDrawerTab("chat");
    setPendingAsk({ botId, text, nonce: Date.now() });
  }, []);
  const clearPendingAsk = useCallback(() => setPendingAsk(null), []);

  const value: OfficeState = {
    pendingAsk,
    askBot,
    clearPendingAsk,
    elevator,
    maxElevator,
    moveElevator,
    goLobby,
    lobbyNonce,
    canEdit,
    editor,
    openEditor,
    anchorsRef,
    registerAnchor,
    requestFrameRef,
    reveal,
    revealSection,
    snapshot,
    floors,
    botsByFloor,
    botById,
    departmentById,
    selectedBotId,
    drawerTab,
    selectBot,
    setDrawerTab,
    focusedFloorId,
    focusFloor,
    cleanView,
    toggleCleanView,
    touring,
    toggleTour,
    controlsRef,
    zoomBy,
    decideInbox,
  };

  return <OfficeContext.Provider value={value}>{children}</OfficeContext.Provider>;
}
