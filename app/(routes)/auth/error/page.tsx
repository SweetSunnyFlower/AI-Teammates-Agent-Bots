import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Sign-in problem · Dotty" };

export default function AuthErrorPage({ searchParams }: PageProps<"/auth/error">) {
  return (
    <main className="lawn-bg grid min-h-dvh place-items-center px-4">
      <section className="w-full max-w-[420px] rounded-[18px] border-2 border-ink bg-panel p-6 shadow-[0_5px_0_0_var(--lip)]">
        <p className="font-mono text-[12px] text-ink-muted">field notes · sign-in problem</p>
        <h1 className="mt-1 text-[22px] font-extrabold text-ink">That link didn&apos;t work</h1>
        <Suspense fallback={null}>
          <ErrorMessage searchParams={searchParams} />
        </Suspense>
        <p className="mt-3 text-[14px] text-ink/80">
          Sign-in links expire after an hour and can only be used once. Request a fresh one and open it in the same browser.
        </p>
        <Link href="/auth/login" className="fn-sticker mt-5 h-11 w-full justify-center bg-[#1d6ff4] text-white">
          Back to sign in
        </Link>
      </section>
    </main>
  );
}

async function ErrorMessage({ searchParams }: { searchParams: PageProps<"/auth/error">["searchParams"] }) {
  const { error } = await searchParams;
  const message = Array.isArray(error) ? error[0] : error;
  if (!message) return null;
  return <p className="mt-3 rounded-[12px] border-2 border-[#b5473f]/60 bg-danger-bg px-3 py-2 font-mono text-[12.5px] text-ink">{message}</p>;
}
