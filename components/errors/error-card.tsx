"use client";

import Link from "next/link";
import { RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";

/** Details only in development — production errors may carry internals. */
export function errorDetail(error: unknown) {
  if (process.env.NODE_ENV === "production") {
    const digest = error && typeof error === "object" && "digest" in error ? String((error as { digest?: unknown }).digest ?? "") : "";
    return digest ? `ref ${digest}` : null;
  }
  return error instanceof Error ? error.message : String(error);
}

/** The sticker-style card shown by error boundaries (pages and panels). */
export function ErrorCard({
  title,
  body,
  error,
  onRetry,
  homeHref,
  compact,
  className,
}: {
  title: string;
  body?: string;
  error?: unknown;
  onRetry?: () => void;
  homeHref?: string;
  compact?: boolean;
  className?: string;
}) {
  const detail = error === undefined ? null : errorDetail(error);
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col gap-2 rounded-[14px] border-2 border-ink bg-panel text-ink shadow-[0_4px_0_0_var(--lip)]",
        compact ? "p-4" : "w-full max-w-[420px] p-6",
        className,
      )}
    >
      <p className={cn("font-extrabold", compact ? "text-[15px]" : "text-[20px]")}>{title}</p>
      <p className="text-[13px] text-ink/75">{body ?? "Something went wrong here. Try again — if it keeps happening, reload the page."}</p>
      {detail ? <p className="truncate font-mono text-[11.5px] text-ink-muted">{detail}</p> : null}
      <div className="mt-1 flex flex-wrap gap-2">
        {onRetry ? (
          <button type="button" onClick={onRetry} className="fn-pill border-ink bg-ink px-3 text-panel hover:bg-ink/85">
            <RotateCcw className="size-3.5" /> Try again
          </button>
        ) : null}
        {homeHref ? (
          <Link href={homeHref} className="fn-pill px-3">
            Back to your office
          </Link>
        ) : null}
      </div>
    </div>
  );
}
