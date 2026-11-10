"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { ArrowRight, Loader2, MailCheck, TriangleAlert } from "lucide-react";
import { sendMagicLink, signInWithGoogle, type MagicLinkState } from "@/app/(routes)/auth/actions";
import { BotAvatar } from "@/components/office/bot-avatar";
import { Input } from "@/components/ui/input";
import type { Bot } from "@/lib/office/types";

const GREETERS: Array<Pick<Bot, "name" | "status" | "avatar">> = [
  { name: "Chief of Staff", status: "working", avatar: { shape: "sphere", color: "#5c8fd6" } },
  { name: "Inbox Zero", status: "waiting", avatar: { shape: "sphere", color: "#e3a857" } },
  { name: "Scout", status: "working", avatar: { shape: "diamond", color: "#8e7cc3" } },
  { name: "Builder", status: "working", avatar: { shape: "capsule", color: "#7fb5a0" } },
];

/** Sign in / sign up: Google or a passwordless magic link (new emails create an account). */
export function LoginCard({ next, error, envReady }: { next: string; error?: string; envReady: boolean }) {
  const [state, formAction] = useActionState<MagicLinkState, FormData>(sendMagicLink, { status: "idle" });

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
          Your team of AI bots is waiting in the office. New here? Signing in creates your account.
        </p>

        {!envReady && (
          <Notice tone="warn">
            Supabase keys are missing. Add them to <code className="font-mono">.env.local</code> and restart the dev server.
          </Notice>
        )}
        {error && <Notice tone="error">{error}</Notice>}

        {state.status === "sent" ? (
          <div className="mt-5 rounded-[14px] border-2 border-ink bg-ok-bg p-4 text-center">
            <MailCheck className="mx-auto size-7 text-[#2e8b3e]" />
            <p className="mt-2 text-[16px] font-extrabold text-ink">Check your inbox</p>
            <p className="mt-1 text-[13.5px] text-ink/80">
              We sent a sign-in link to <b>{state.email}</b>. It expires in 1 hour.
            </p>
            <form action={formAction} className="mt-3">
              <input type="hidden" name="email" value={state.email} />
              <input type="hidden" name="next" value={next} />
              <ResendButton />
            </form>
          </div>
        ) : (
          <>
            <form action={signInWithGoogle} className="mt-5">
              <input type="hidden" name="next" value={next} />
              <GoogleButton disabled={!envReady} />
            </form>

            <div className="my-4 flex items-center gap-3 font-mono text-[12px] text-ink-muted">
              <span className="h-px flex-1 bg-hairline" /> or use email <span className="h-px flex-1 bg-hairline" />
            </div>

            <form action={formAction} className="flex flex-col gap-2.5">
              <input type="hidden" name="next" value={next} />
              <label htmlFor="email" className="font-mono text-[12.5px] text-ink-muted">
                email
              </label>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                placeholder="you@example.com"
                defaultValue={state.status === "error" ? state.email : undefined}
                disabled={!envReady}
                aria-invalid={state.status === "error"}
                className="h-11 rounded-[12px] border-2 border-ink/80 bg-field px-3 text-[15px]"
              />
              {state.status === "error" && (
                <p className="text-[13px] text-[#b5473f]" role="alert">
                  {state.message}
                </p>
              )}
              <MagicLinkButton disabled={!envReady} />
            </form>
          </>
        )}

        <p className="mt-5 text-center font-mono text-[11.5px] text-ink-muted">
          bots never send, pay, publish, delete or merge without your ok.
        </p>
      </section>
    </div>
  );
}

function MagicLinkButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={disabled || pending} className="fn-sticker h-12 w-full justify-center bg-[#1d6ff4] text-white">
      {pending ? <Loader2 className="size-4.5 animate-spin" /> : <ArrowRight className="size-4.5" />}
      {pending ? "Sending link…" : "Email me a sign-in link"}
    </button>
  );
}

function ResendButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="fn-pill">
      {pending ? "Sending…" : "Send it again"}
    </button>
  );
}

function GoogleButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={disabled || pending} className="fn-sticker h-12 w-full justify-center bg-white">
      {pending ? <Loader2 className="size-4.5 animate-spin" /> : <GoogleMark />}
      Continue with Google
    </button>
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

function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" className="size-5" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}
