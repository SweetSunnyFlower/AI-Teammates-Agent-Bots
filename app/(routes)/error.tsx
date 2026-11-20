"use client";

import { useEffect } from "react";
import { ErrorCard } from "@/components/errors/error-card";

/** Page-level error boundary for every route (office, boards, auth, setup). */
export default function RouteError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main className="lawn-bg grid min-h-dvh place-items-center p-4">
      <ErrorCard title="出了点问题" error={error} onRetry={retry} homeHref="/workspace" />
    </main>
  );
}
