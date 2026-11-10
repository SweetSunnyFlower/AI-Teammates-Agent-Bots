import Link from "next/link";

export default function LandingPage() {
  return (
    <main className="paper-bg flex min-h-dvh flex-col items-center justify-center gap-6 px-6 text-center">
      <p className="font-mono text-[13px] text-ink-muted">field notes · dotty</p>
      <h1 className="max-w-xl font-mono text-[44px] leading-[1.05] tracking-tight text-ink">
        Run a team of AI bots from a tiny office.
      </h1>
      <p className="max-w-md text-[16px] leading-relaxed text-ink/80">
        A Head bot plans the work, each floor gets it done, and nothing is sent, paid, published, deleted or merged
        without your approval.
      </p>
      <div className="flex gap-2">
        <Link href="/auth/login" className="fn-pill border-ink bg-ink px-4 py-2 text-[14px] text-panel hover:bg-ink/85">
          Get started
        </Link>
        <Link href="/workspace" className="fn-pill px-4 py-2 text-[14px]">
          See the demo office
        </Link>
      </div>
    </main>
  );
}
