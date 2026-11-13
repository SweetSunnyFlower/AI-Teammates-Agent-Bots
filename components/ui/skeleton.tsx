import { cn } from "@/lib/utils";

/** A soft placeholder block while something loads (pulses; still under reduced motion it just sits). */
export function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return <div aria-hidden data-slot="skeleton" className={cn("rounded-[8px] bg-ink/10 motion-safe:animate-pulse", className)} {...props} />;
}

/** A few lines of text-shaped skeletons. */
export function SkeletonLines({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div aria-hidden className={cn("flex flex-col gap-2", className)}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className="h-3" style={{ width: `${[92, 78, 64, 85, 55][i % 5]}%` }} />
      ))}
    </div>
  );
}

/** Screen-reader announcement for a loading region. */
export function LoadingLabel({ children }: { children: React.ReactNode }) {
  return (
    <span role="status" className="sr-only">
      {children}
    </span>
  );
}
