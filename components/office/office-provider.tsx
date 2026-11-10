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
import { toast } from "sonner";
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

/** A short speech bubble over a bot in the office (start / finish / handoff). */
export interface BotBubble {
  text: string;
  kind: "start" | "done" | "fail" | "info";
  key: number;
}

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

  const [focusMessage, setFocusMessage] = useState<OfficeState["focusMessage"]>(null);
  const openReply = useCallback((botId: string, taskId: string) => {
    setSelectedBotId(botId);
    setDrawerTab("chat");
    setFocusMessage({ botId, prefix: `task-${taskId}`, nonce: Date.now() });
  }, []);
  const clearFocusMessage = useCallback(() => setFocusMessage(null), []);

  // Bubbles + toasts for new background-run activity (not for what was there on page load).
  const [bubbles, setBubbles] = useState<Record<string, BotBubble>>({});
  const seenActivity = useRef<Set<string> | null>(null);
  useEffect(() => {
    const ids = snapshot.activity.map((a) => a.id);
    if (!seenActivity.current) {
      seenActivity.current = new Set(ids);
      return;
    }
    const seen = seenActivity.current;
    const fresh = snapshot.activity.filter((a) => !seen.has(a.id)).reverse(); // oldest first
    ids.forEach((id) => seen.add(id));
    const timers: number[] = [];
    for (const a of fresh) {
      const bot = snapshot.bots.find((b) => b.id === a.botId);
      if (!bot) continue;
      const title = /“(.+?)”/.exec(a.text)?.[1] ?? a.text;
      let bubble: Omit<BotBubble, "key"> | null = null;
      if (a.type === "run_started") bubble = { kind: "start", text: `On it — ${title}` };
      else if (a.type === "run_finished") {
        bubble = { kind: "done", text: `Done ✓ ${title}` };
        toast.success(`${bot.name} finished`, {
          description: title,
          action: a.taskId ? { label: "Read reply", onClick: () => openReply(bot.id, a.taskId!) } : undefined,
        });
      } else if (a.type === "run_failed") {
        bubble = { kind: "fail", text: `Stuck — ${title}` };
        toast.error(`${bot.name} couldn't finish`, {
          description: title,
          action: a.taskId ? { label: "See why", onClick: () => openReply(bot.id, a.taskId!) } : undefined,
        });
      } else if (a.type === "tool" && a.text.startsWith("handed")) bubble = { kind: "info", text: a.text.replace(/^handed/, "Handed") };
      if (!bubble) continue;
      const key = Date.now() + Math.random();
      setBubbles((b) => ({ ...b, [bot.id]: { ...bubble!, key } }));
      timers.push(
        window.setTimeout(
          () => setBubbles((b) => (b[bot.id]?.key === key ? Object.fromEntries(Object.entries(b).filter(([id]) => id !== bot.id)) : b)),
          bubble.kind === "start" || bubble.kind === "info" ? 6000 : 9000,
        ),
      );
    }
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [snapshot.activity, snapshot.bots, openReply]);

  const value: OfficeState = {
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
