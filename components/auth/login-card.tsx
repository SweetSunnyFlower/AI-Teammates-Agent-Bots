"use client";

import { useState, type FormEvent } from "react";
import { ArrowRight, Loader2, LockKeyhole, TriangleAlert } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { BotAvatar } from "@/components/office/bot-avatar";
import { Input } from "@/components/ui/input";
import type { Bot } from "@/lib/office/types";

const GREETERS: Array<Pick<Bot, "name" | "status" | "avatar">> = [
  { name: "Chief of Staff", status: "working", avatar: { shape: "sphere", color: "#5c8fd6" } },
  { name: "Inbox Zero", status: "waiting", avatar: { shape: "sphere", color: "#e3a857" } },
  { name: "Scout", status: "working", avatar: { shape: "diamond", color: "#8e7cc3" } },
  { name: "Builder", status: "working", avatar: { shape: "capsule", color: "#7fb5a0" } },
];

export function LoginCard({ next, error, envReady }: { next: string; error?: string; envReady: boolean }) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(error ?? null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!envReady) return;
    setPending(true);
    setMessage(null);

    const data = new FormData(event.currentTarget);
    const email = String(data.get("email") ?? "").trim().toLowerCase();
    const password = String(data.get("password") ?? "");
    const name = String(data.get("name") ?? "").trim() || email.split("@")[0] || "Owner";

    const result =
      mode === "signup"
        ? await authClient.signUp.email({ email, password, name })
        : await authClient.signIn.email({ email, password });

    if (result.error) {
      setMessage(result.error.message ?? "Couldn't sign you in.");
      setPending(false);
      return;
    }
    window.location.assign(next);
  }

  return (
    <div className="w-full max-w-[420px]">
      <div className="flex justify-center gap-3 pb-0" aria-hidden>
        {GREETERS.map((b) => (
          <div key={b.name} className="translate-y-3">
            <BotAvatar bot={b} size={58} animated />
          </div>
        ))}
      </div>

      <section className="relative rounded-[18px] border-2 border-ink bg-panel p-6 shadow-[0_5px_0_0_var(--lip)] sm:p-7">
        <div className="flex items-center gap-2.5">
          <span className="grid size-10 place-items-center rounded-[10px] border-2 border-ink bg-chip-sky text-[20px] leading-none">🏢</span>
          <div>
            <p className="font-mono text-[12px] text-ink-muted">field notes · sign in</p>
            <h1 className="text-[24px] leading-tight font-extrabold text-ink">Welcome to Dotty</h1>
          </div>
        </div>
        <p className="mt-3 text-[14px] leading-relaxed text-ink/80">
          {mode === "signin" ? "Sign in to open your office." : "Create the owner account for this self-hosted office."}
        </p>

        {!envReady && (
          <Notice tone="warn">
            Database auth is not configured. Add <code className="font-mono">DATABASE_URL</code> and{" "}
            <code className="font-mono">BETTER_AUTH_SECRET</code> to <code className="font-mono">.env.local</code>.
          </Notice>
        )}
        {message && <Notice tone="error">{message}</Notice>}

        <div className="mt-5 grid grid-cols-2 gap-1 rounded-[12px] border-2 border-ink bg-field p-1">
          <button
            type="button"
            onClick={() => setMode("signin")}
            className={`rounded-[8px] px-3 py-2 text-[13px] font-bold ${mode === "signin" ? "bg-chip-sky text-ink" : "text-ink/60"}`}
          >
            Sign in
          </button>
          <button
            type="button"
            onClick={() => setMode("signup")}
            className={`rounded-[8px] px-3 py-2 text-[13px] font-bold ${mode === "signup" ? "bg-chip-sky text-ink" : "text-ink/60"}`}
          >
            Create account
          </button>
        </div>

        <form onSubmit={submit} className="mt-4 flex flex-col gap-2.5">
          {mode === "signup" && (
            <>
              <label htmlFor="name" className="font-mono text-[12.5px] text-ink-muted">name</label>
              <Input id="name" name="name" autoComplete="name" placeholder="Your name" disabled={!envReady || pending} className="h-11 rounded-[12px] border-2 border-ink/80 bg-field px-3 text-[15px]" />
            </>
          )}
          <label htmlFor="email" className="font-mono text-[12.5px] text-ink-muted">email</label>
          <Input id="email" name="email" type="email" autoComplete="email" required placeholder="you@example.com" disabled={!envReady || pending} className="h-11 rounded-[12px] border-2 border-ink/80 bg-field px-3 text-[15px]" />
          <label htmlFor="password" className="font-mono text-[12.5px] text-ink-muted">password</label>
          <Input id="password" name="password" type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} minLength={8} required placeholder="At least 8 characters" disabled={!envReady || pending} className="h-11 rounded-[12px] border-2 border-ink/80 bg-field px-3 text-[15px]" />
          <button type="submit" disabled={!envReady || pending} className="fn-sticker mt-1 h-12 w-full justify-center bg-[#1d6ff4] text-white">
            {pending ? <Loader2 className="size-4.5 animate-spin" /> : mode === "signin" ? <LockKeyhole className="size-4.5" /> : <ArrowRight className="size-4.5" />}
            {pending ? "Working…" : mode === "signin" ? "Sign in" : "Create account"}
          </button>
        </form>

        <p className="mt-5 text-center font-mono text-[11.5px] text-ink-muted">
          bots never send, pay, publish, delete or merge without your ok.
        </p>
      </section>
    </div>
  );
}

function Notice({ tone, children }: { tone: "warn" | "error"; children: React.ReactNode }) {
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={
        tone === "warn"
          ? "mt-4 flex gap-2 rounded-[12px] border-2 border-ink/70 bg-honey px-3 py-2.5 text-[13px] text-ink"
          : "mt-4 flex gap-2 rounded-[12px] border-2 border-[#b5473f]/70 bg-danger-bg px-3 py-2.5 text-[13px] text-ink"
      }
    >
      <TriangleAlert className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </p>
  );
}
