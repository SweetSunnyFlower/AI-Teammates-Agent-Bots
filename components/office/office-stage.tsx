"use client";

import dynamic from "next/dynamic";
import { useSyncExternalStore } from "react";
import { ChevronDown, ChevronUp, Minus, Plus } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { OfficeOverlay } from "./office-overlay";
import { AskHead } from "@/components/chat/ask-head";
import { useOffice, VISIBLE_FLOORS } from "./office-provider";

// three.js needs the browser: load the canvas on the client only.
const OfficeCanvas = dynamic(() => import("./scene/office-canvas"), {
  ssr: false,
  loading: () => <StageMessage text="setting up the office…" />,
});

const noopSubscribe = () => () => {};
/**
 * Does this browser do WebGL? Asked once and remembered: React calls getSnapshot on every render,
 * and a browser only allows about 16 live WebGL contexts — probing on each render would use them
 * all up, and the browser then kills the office’s own context, leaving the building blank. The
 * probe context is released straight away for the same reason.
 */
let webglSupport: boolean | null = null;
function detectWebGL() {
  if (webglSupport !== null) return webglSupport;
  try {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    context?.getExtension("WEBGL_lose_context")?.loseContext();
    webglSupport = Boolean(context);
  } catch {
    webglSupport = false;
  }
  return webglSupport;
}

export function OfficeStage() {
  // null on the server, then the real answer on the client.
  const webgl = useSyncExternalStore(noopSubscribe, detectWebGL, () => null);
  const { maxElevator } = useOffice();
  const riding = maxElevator > 0;

  return (
    <div className="relative h-full min-h-[420px] w-full overflow-hidden">
      {webgl === false ? (
        <StageMessage text="3D isn't available in this browser — the panels show everything the office does." />
      ) : webgl ? (
        <>
          <OfficeCanvas />
          <OfficeOverlay />
        </>
      ) : (
        <StageMessage text="setting up the office…" />
      )}
      <ViewControls />
      {riding && <ElevatorEdges />}
    </div>
  );
}

/** Hidden-floor counts at the top and bottom edges of the view (click to ride). */
function ElevatorEdges() {
  const { elevator, maxElevator, moveElevator } = useOffice();
  const above = maxElevator - elevator;
  const below = elevator;
  const chip =
    "fn-sticker pointer-events-auto h-8 gap-1.5 rounded-full px-3 font-mono text-[12.5px] font-normal";
  return (
    <>
      {above > 0 && (
        <div className="pointer-events-none absolute inset-x-0 top-3 z-10 flex justify-center lg:top-[84px]">
          <button type="button" className={chip} onClick={() => moveElevator(1)}>
            <ChevronUp className="size-4" strokeWidth={3} /> {above} more floor{above === 1 ? "" : "s"} above
          </button>
        </div>
      )}
      {below > 0 && (
        <div className="pointer-events-none absolute inset-x-0 bottom-[140px] z-10 flex justify-center">
          <button type="button" className={chip} onClick={() => moveElevator(-1)}>
            <ChevronDown className="size-4" strokeWidth={3} /> {below} more floor{below === 1 ? "" : "s"} below
          </button>
        </div>
      )}
    </>
  );
}

/** ▲ / ▼ ride one floor; the middle shows which floors are in view. */
function ElevatorButtons() {
  const { elevator, maxElevator, moveElevator, floors } = useOffice();
  const lowest = elevator + 1;
  const highest = Math.min(elevator + VISIBLE_FLOORS, floors.length);
  return (
    <span className="flex items-center gap-1" role="group" aria-label="Elevator">
      <button type="button" className="fn-pill size-[30px] justify-center px-0" onClick={() => moveElevator(-1)} disabled={elevator === 0} aria-label="Ride down one floor">
        <ChevronDown className="size-4" strokeWidth={2.5} />
      </button>
      <span className="fn-pill pointer-events-none min-w-[74px] justify-center" aria-live="polite">
        {lowest}F–{highest}F
      </span>
      <button type="button" className="fn-pill size-[30px] justify-center px-0" onClick={() => moveElevator(1)} disabled={elevator >= maxElevator} aria-label="Ride up one floor">
        <ChevronUp className="size-4" strokeWidth={2.5} />
      </button>
    </span>
  );
}

function StageMessage({ text }: { text: string }) {
  return (
    <div className="absolute inset-0 grid place-items-center">
      <p className="font-mono text-[13px] text-ink-muted">{text}</p>
    </div>
  );
}

function ViewControls() {
  const { elevator, focusedFloorId, goLobby, maxElevator, touring, toggleTour, cleanView, toggleCleanView, zoomBy } = useOffice();
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-3 z-10 flex flex-col items-center gap-1.5">
      <AskHead />
      <div className="pointer-events-auto flex flex-wrap items-center justify-center gap-1.5">
        {maxElevator > 0 && <ElevatorButtons />}
        <button
          type="button"
          className="fn-pill"
          data-active={elevator === 0 && focusedFloorId === null && !touring}
          onClick={goLobby}
          title="Back to the ground floor and the starting angle"
        >
          lobby
        </button>
        <button type="button" className="fn-pill" data-active={touring} onClick={toggleTour} aria-pressed={touring}>
          tour
        </button>
        <button type="button" className="fn-pill" data-active={cleanView} onClick={toggleCleanView} aria-pressed={cleanView}>
          clean view
        </button>
        <Tooltip>
          <TooltipTrigger className="fn-pill size-[30px] justify-center px-0" onClick={() => zoomBy(1 / 1.25)} aria-label="Zoom out">
            <Minus className="size-3.5" />
          </TooltipTrigger>
          <TooltipContent>Zoom out</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger className="fn-pill size-[30px] justify-center px-0" onClick={() => zoomBy(1.25)} aria-label="Zoom in">
            <Plus className="size-3.5" />
          </TooltipTrigger>
          <TooltipContent>Zoom in</TooltipContent>
        </Tooltip>
      </div>
      <p className="rounded-full bg-panel/80 px-2.5 py-0.5 font-mono text-[11.5px] text-ink">
        {maxElevator > 0
          ? "click ▲▼ to ride · scroll to zoom · drag to rotate · click a bot"
          : "drag to rotate · right-drag to pan · scroll to zoom · click a bot"}
      </p>
    </div>
  );
}
