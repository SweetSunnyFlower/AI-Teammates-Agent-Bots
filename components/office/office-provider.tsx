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
import { useOfficeLife, type BotBubble } from "./use-office-life";
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
  /** Bot id: the anchor follows the bot when it walks (see motion.ts). */
  motionKey?: string;
}

/** What the team dialogs are editing (undefined id = create). */
export type Editor =
  | { type: "bot"; botId?: string; departmentId?: string }
  | { type: "department"; departmentId?: string }
  | { type: "routine"; routineId?: string; botId?: string }
  | null;

/** A short speech bubble over a bot in the office (start / finish / handoff). */
export type { BotBubble } from "./use-office-life";

export type SettingsTab = "connectors" | "channels" | "workspace";

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

  /** Settings dialog (header gear). */
  settingsTab: SettingsTab | null;
  openSettings: (tab?: SettingsTab) => void;
  closeSettings: () => void;

  /** Live speech bubbles over bots, keyed by bot id. */
  bubbles: Record<string, BotBubble>;
  /** Open a bot's chat scrolled to (and highlighting) a task's report. */
  openReply: (botId: string, taskId: string) => void;
  focusMessage: { botId: string; prefix: string; nonce: number } | null;
  clearFocusMessage: () => void;
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
  /** Fetch fresh office data and swap it in (no page re-render). Use after any change. */
  refreshOffice: () => Promise<void>;
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
  const snapshotSignature = useRef(JSON.stringify(initialSnapshot));
  // A new server snapshot (first render, or a page refresh) — adopt it (keep UI state).
  const [source, setSource] = useState(initialSnapshot);
  if (source !== initialSnapshot) {
    setSource(initialSnapshot);
    setSnapshot(initialSnapshot);
  }
  useEffect(() => {
    snapshotSignature.current = JSON.stringify(initialSnapshot);
  }, [initialSnapshot]);

  /**
   * Live data without re-rendering the page: fetch the snapshot as JSON and swap it in. Calls
   * that arrive while one is in flight are merged into one follow-up fetch.
   */
  const workspaceId = initialSnapshot.workspace.id;
  const liveData = workspaceId !== "demo"; // the demo office has nothing to fetch
  const inflight = useRef<Promise<void> | null>(null);
  const fetchAgain = useRef(false);
  const refreshOffice = useCallback(() => {
    if (!liveData) return Promise.resolve();
    if (inflight.current) {
      fetchAgain.current = true;
      return inflight.current;
    }
    const run = async () => {
      do {
        fetchAgain.current = false;
        try {
          const res = await fetch(`/api/office/${workspaceId}`, { cache: "no-store" });
          if (res.ok) {
            const next = (await res.json()) as OfficeSnapshot;
            const signature = JSON.stringify(next);
            if (signature !== snapshotSignature.current) {
              snapshotSignature.current = signature;
              setSnapshot(next);
            }
          }
        } catch {
          // Offline for a moment — the next event or poll catches up.
        }
      } while (fetchAgain.current);
    };
    inflight.current = run().finally(() => {
      inflight.current = null;
    });
    return inflight.current;
  }, [workspaceId, liveData]);
  const [editor, openEditor] = useState<Editor>(null);
  const [settingsTab, setSettingsTab] = useState<SettingsTab | null>(null);
  const openSettings = useCallback((tab: SettingsTab = "connectors") => setSettingsTab(tab), []);
  const closeSettings = useCallback(() => setSettingsTab(null), []);
  const [pendingAsk, setPendingAsk] = useState<OfficeState["pendingAsk"]>(null);
  // Open at the top of the building (the Head office), not the lobby.
  const [elevator, setElevator] = useState(() => Math.max(0, snapshot.departments.length - VISIBLE_FLOORS));
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

  // The Head bot opens on Chat (you talk to it); everyone else opens on Activity.
  const headId = useMemo(() => snapshot.bots.find((b) => b.role === "head")?.id ?? null, [snapshot.bots]);
  const selectBot = useCallback(
    (botId: string | null, tab?: DrawerTab) => {
      setSelectedBotId(botId);
      if (botId) setDrawerTab(tab ?? (botId === headId ? "chat" : "activity"));
    },
    [headId],
  );

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

  // Escape leaves a focused floor (and stops a tour): the camera pushes in on focus, so there
  // has to be a way back out that is not the lobby button.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setFocusedFloorId(null);
      setTouring(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
              statusDetail: decision === "approve" ? `已批准：${item.title}` : "休息中",
              lastActive: "刚刚",
            }
          : b,
      ),
      activity: [
        {
          id: `local-${item.id}`,
          time: "刚刚",
          botId: item.botId,
          text: decision === "approve" ? `已获得你对“${item.title}”的批准` : `用户跳过“${item.title}”`,
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

  const [focusMessage, setFocusMessage] = useState<OfficeState["focusMessage"]>(null);
  const openReply = useCallback((botId: string, taskId: string) => {
    setSelectedBotId(botId);
    setDrawerTab("chat");
    setFocusMessage({ botId, prefix: `task-${taskId}`, nonce: Date.now() });
  }, []);
  const clearFocusMessage = useCallback(() => setFocusMessage(null), []);

  // Bubbles, toasts, handoff walks and NPC life for resting bots (see use-office-life.ts).
  const bubbles = useOfficeLife({
    snapshot,
    floors,
    botsByFloor,
    elevator,
    visibleFloors: VISIBLE_FLOORS,
    focusedFloorId,
    openReply,
    revealSection,
  });

  const value: OfficeState = {
    settingsTab,
    openSettings,
    closeSettings,
    bubbles,
    openReply,
    focusMessage,
    clearFocusMessage,
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
    refreshOffice,
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
