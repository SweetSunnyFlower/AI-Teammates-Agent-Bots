import Link from "next/link";

export default function NotFound() {
  return (
    <main className="lawn-bg grid min-h-dvh place-items-center p-4">
      <div className="flex w-full max-w-[420px] flex-col gap-2 rounded-[14px] border-2 border-ink bg-panel p-6 text-ink shadow-[0_4px_0_0_var(--lip)]">
        <p className="text-[20px] font-extrabold">Nothing here</p>
        <p className="text-[13px] text-ink/75">That page or workspace doesn&apos;t exist, or it isn&apos;t yours.</p>
        <Link href="/workspace" className="fn-pill mt-1 self-start px-3">
          Back to your office
        </Link>
      </div>
    </main>
  );
}
