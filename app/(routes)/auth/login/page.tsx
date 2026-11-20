import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { LoginCard } from "@/components/auth/login-card";
import { hasDatabaseEnv } from "@/lib/db/env";
import { safeNext } from "@/lib/auth/safe-next";

export const metadata: Metadata = { title: "登录 · Dotty" };
const envReady = hasDatabaseEnv && Boolean(process.env.BETTER_AUTH_SECRET);

export default function LoginPage({ searchParams }: PageProps<"/auth/login">) {
  return (
    <main className="lawn-bg relative grid min-h-dvh place-items-center overflow-hidden px-4 py-10">
      <GardenDecor />
      <Link href="/" className="fn-sticker absolute top-4 left-4 h-10 text-[14px]">
        ← Dotty
      </Link>
      {/* searchParams is request-time data under Cache Components → read it inside Suspense */}
      <Suspense fallback={<LoginCard next="/workspace" envReady={envReady} />}>
        <LoginFromParams searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function LoginFromParams({ searchParams }: { searchParams: PageProps<"/auth/login">["searchParams"] }) {
  const params = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  return <LoginCard next={safeNext(one(params.next))} error={one(params.error)} envReady={envReady} />;
}

/** A few flat trees and a path so the sign-in page sits in the same garden as the office. */
function GardenDecor() {
  const trees = [
    { left: "7%", top: "18%", s: 1.1 },
    { left: "14%", top: "72%", s: 0.9 },
    { left: "84%", top: "14%", s: 0.95 },
    { left: "90%", top: "64%", s: 1.2 },
    { left: "76%", top: "86%", s: 0.8 },
  ];
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden>
      <div className="absolute top-[58%] -left-[10%] h-16 w-[130%] -rotate-[8deg] bg-[#efd5a4]/80" />
      {trees.map((t, i) => (
        <svg key={i} viewBox="0 0 60 80" className="absolute" style={{ left: t.left, top: t.top, width: 60 * t.s, height: 80 * t.s }}>
          <rect x="26" y="50" width="8" height="26" rx="2" fill="#8a5a3b" />
          <circle cx="30" cy="32" r="26" fill="#5fa046" />
          <circle cx="40" cy="42" r="14" fill="#4e8c3b" />
        </svg>
      ))}
    </div>
  );
}
