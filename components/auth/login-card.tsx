"use client";

import { useState, type FormEvent } from "react";
import { ArrowRight, Loader2, LockKeyhole, TriangleAlert } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { BotAvatar } from "@/components/office/bot-avatar";
import { Input } from "@/components/ui/input";
import type { Bot } from "@/lib/office/types";

const GREETERS: Array<Pick<Bot, "name" | "status" | "avatar">> = [
  { name: "总控助理", status: "working", avatar: { shape: "sphere", color: "#5c8fd6" } },
  { name: "收件箱助手", status: "waiting", avatar: { shape: "sphere", color: "#e3a857" } },
  { name: "研究员", status: "working", avatar: { shape: "diamond", color: "#8e7cc3" } },
  { name: "工程师", status: "working", avatar: { shape: "capsule", color: "#7fb5a0" } },
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
    const name = String(data.get("name") ?? "").trim() || email.split("@")[0] || "所有者";

    const result =
      mode === "signup"
        ? await authClient.signUp.email({ email, password, name })
        : await authClient.signIn.email({ email, password });

    if (result.error) {
      setMessage(friendlyAuthError(result.error.message));
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
            <p className="font-mono text-[12px] text-ink-muted">现场笔记 · 登录</p>
            <h1 className="text-[24px] leading-tight font-extrabold text-ink">欢迎使用 Dotty</h1>
          </div>
        </div>
        <p className="mt-3 text-[14px] leading-relaxed text-ink/80">
          {mode === "signin" ? "登录后进入你的办公室。" : "为这个自托管办公室创建所有者账户。"}
        </p>

        {!envReady && (
          <Notice tone="warn">
            数据库认证尚未配置。请在 <code className="font-mono">.env.local</code> 中添加{" "}
            <code className="font-mono">DATABASE_URL</code> 和 <code className="font-mono">BETTER_AUTH_SECRET</code>。
          </Notice>
        )}
        {message && <Notice tone="error">{message}</Notice>}

        <div className="mt-5 grid grid-cols-2 gap-1 rounded-[12px] border-2 border-ink bg-field p-1">
          <button
            type="button"
            onClick={() => setMode("signin")}
            className={`rounded-[8px] px-3 py-2 text-[13px] font-bold ${mode === "signin" ? "bg-chip-sky text-ink" : "text-ink/60"}`}
          >
            登录
          </button>
          <button
            type="button"
            onClick={() => setMode("signup")}
            className={`rounded-[8px] px-3 py-2 text-[13px] font-bold ${mode === "signup" ? "bg-chip-sky text-ink" : "text-ink/60"}`}
          >
            创建账户
          </button>
        </div>

        <form onSubmit={submit} className="mt-4 flex flex-col gap-2.5">
          {mode === "signup" && (
            <>
              <label htmlFor="name" className="font-mono text-[12.5px] text-ink-muted">名称</label>
              <Input id="name" name="name" autoComplete="name" placeholder="你的名称" disabled={!envReady || pending} className="h-11 rounded-[12px] border-2 border-ink/80 bg-field px-3 text-[15px]" />
            </>
          )}
          <label htmlFor="email" className="font-mono text-[12.5px] text-ink-muted">邮箱</label>
          <Input id="email" name="email" type="email" autoComplete="email" required placeholder="you@example.com" disabled={!envReady || pending} className="h-11 rounded-[12px] border-2 border-ink/80 bg-field px-3 text-[15px]" />
          <label htmlFor="password" className="font-mono text-[12.5px] text-ink-muted">密码</label>
          <Input id="password" name="password" type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} minLength={8} required placeholder="至少 8 个字符" disabled={!envReady || pending} className="h-11 rounded-[12px] border-2 border-ink/80 bg-field px-3 text-[15px]" />
          <button type="submit" disabled={!envReady || pending} className="fn-sticker mt-1 h-12 w-full justify-center bg-[#1d6ff4] text-white">
            {pending ? <Loader2 className="size-4.5 animate-spin" /> : mode === "signin" ? <LockKeyhole className="size-4.5" /> : <ArrowRight className="size-4.5" />}
            {pending ? "处理中…" : mode === "signin" ? "登录" : "创建账户"}
          </button>
        </form>

        <p className="mt-5 text-center font-mono text-[11.5px] text-ink-muted">
          Bot 不会在未经你批准的情况下发送、支付、发布、删除或合并任何内容。
        </p>
      </section>
    </div>
  );
}

function friendlyAuthError(message?: string) {
  const text = message?.toLowerCase() ?? "";
  if (text.includes("invalid") && text.includes("password")) return "邮箱或密码不正确。";
  if (text.includes("already") || text.includes("exist")) return "该邮箱已经注册，请直接登录。";
  if (text.includes("password")) return "密码不符合要求，请至少输入 8 个字符。";
  if (text.includes("email")) return "邮箱格式不正确，或者该邮箱暂时无法使用。";
  return "登录失败，请稍后重试。";
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
