"use client";

import { catchError, type ErrorInfo } from "next/error";
import { ErrorCard } from "./error-card";

/**
 * Error boundary for one part of the office (3D scene, a panel, a dialog): if it crashes, the rest
 * of the office keeps working and this part shows a card with "Try again".
 */
function PanelFallback({ label, className }: { label: string; className?: string }, { error, retry }: ErrorInfo) {
  return (
    <div className={className ?? "grid h-full place-items-center p-3"}>
      <ErrorCard compact title={`${label}遇到问题`} error={error} onRetry={retry} className="pointer-events-auto" />
    </div>
  );
}

export const PanelBoundary = catchError(PanelFallback);
