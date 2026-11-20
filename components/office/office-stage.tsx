"use client";

import dynamic from "next/dynamic";
import { useSyncExternalStore } from "react";
import { ChevronDown, ChevronUp, Minus, Plus } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { OfficeOverlay } from "./office-overlay";
import { AskHead } from "@/components/chat/ask-head";
import { useOffice, VISIBLE_FLOORS } from "./office-provider";
import { LoadingLabel, Skeleton } from "@/components/ui/skeleton";

// three.js needs the browser: load the canvas on the client only.
const OfficeCanvas = dynamic(() => import("./scene/office-canvas"), {
  ssr: false,
  loading: () => <StageLoading />,
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
        <StageMessage text="当前浏览器无法显示 3D 场景，左右面板仍会展示办公室的全部动态。" />
      ) : webgl ? (
        <>
          <OfficeCanvas />
          <OfficeOverlay />
        </>
      ) : (
        <StageLoading />
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
            <ChevronUp className="size-4" strokeWidth={3} /> 上方还有 {above} 层
          </button>
        </div>
      )}
      {below > 0 && (
        <div className="pointer-events-none absolute inset-x-0 bottom-[140px] z-10 flex justify-center">
          <button type="button" className={chip} onClick={() => moveElevator(-1)}>
            <ChevronDown className="size-4" strokeWidth={3} /> 下方还有 {below} 层
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
    <span className="flex items-center gap-1" role="group" aria-label="楼层电梯">
      <button type="button" className="fn-pill size-[30px] justify-center px-0" onClick={() => moveElevator(-1)} disabled={elevator === 0} aria-label="向下一层">
        <ChevronDown className="size-4" strokeWidth={2.5} />
      </button>
      <span className="fn-pill pointer-events-none min-w-[74px] justify-center" aria-live="polite">
        {lowest}F–{highest}F
      </span>
      <button type="button" className="fn-pill size-[30px] justify-center px-0" onClick={() => moveElevator(1)} disabled={elevator >= maxElevator} aria-label="向上一层">
        <ChevronUp className="size-4" strokeWidth={2.5} />
      </button>
    </span>
  );
}

/** While three.js loads: a stack of floors as placeholders. */
function StageLoading() {
  return (
    <div className="absolute inset-0 grid place-items-center" aria-busy="true">
      <LoadingLabel>正在布置办公室…</LoadingLabel>
      <div className="flex flex-col items-center gap-3">
        <div className="flex flex-col items-center gap-1.5" aria-hidden>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-12 w-[220px] rounded-[10px] bg-panel/45" style={{ animationDelay: `${i * 150}ms` }} />
          ))}
        </div>
        <p className="rounded-full bg-panel/80 px-3 py-1 font-mono text-[12.5px] text-ink">正在布置办公室…</p>
      </div>
    </div>
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
          title="回到大厅和初始视角"
        >
          大厅
        </button>
        <button type="button" className="fn-pill" data-active={touring} onClick={toggleTour} aria-pressed={touring}>
          巡览
        </button>
        <button type="button" className="fn-pill" data-active={cleanView} onClick={toggleCleanView} aria-pressed={cleanView}>
          简洁视图
        </button>
        <Tooltip>
          <TooltipTrigger className="fn-pill size-[30px] justify-center px-0" onClick={() => zoomBy(1 / 1.25)} aria-label="缩小">
            <Minus className="size-3.5" />
          </TooltipTrigger>
          <TooltipContent>缩小</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger className="fn-pill size-[30px] justify-center px-0" onClick={() => zoomBy(1.25)} aria-label="放大">
            <Plus className="size-3.5" />
          </TooltipTrigger>
          <TooltipContent>放大</TooltipContent>
        </Tooltip>
      </div>
      <p className="rounded-full bg-panel/80 px-2.5 py-0.5 font-mono text-[11.5px] text-ink">
        {maxElevator > 0
          ? "点击 ▲▼ 切换楼层 · 滚轮缩放 · 拖动旋转 · 点击 Bot"
          : "拖动旋转 · 右键拖动平移 · 滚轮缩放 · 点击 Bot"}
      </p>
    </div>
  );
}
