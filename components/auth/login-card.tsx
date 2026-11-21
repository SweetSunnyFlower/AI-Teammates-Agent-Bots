"use client";

import { useEffect, useState, type FormEvent } from "react";
import { ArrowRight, Loader2, LockKeyhole, MailCheck, TriangleAlert } from "lucide-react";
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

type MessageTone = "error" | "success";

export function LoginCard({
  next,
  error,
  envReady,
  signupReady,
}: {
  next: string;
  error?: string;
  envReady: boolean;
  signupReady: boolean;
}) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(error ?? null);
  const [messageTone, setMessageTone] = useState<MessageTone>("error");
  const [verificationEmail, setVerificationEmail] = useState<string | null>(null);
  const [verificationSent, setVerificationSent] = useState(false);
  const [resendPending, setResendPending] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  function showMessage(text: string | null, tone: MessageTone = "error") {
    setMessage(text);
    setMessageTone(tone);
  }

  function switchMode(nextMode: "signin" | "signup") {
    setMode(nextMode);
    setVerificationEmail(null);
    setVerificationSent(false);
    setCooldown(0);
    showMessage(null);
  }

  function backToSignIn() {
    setVerificationSent(false);
    setVerificationEmail(null);
    setCooldown(0);
    showMessage(null);
    setMode("signin");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!envReady || (mode === "signup" && !signupReady)) return;

    const form = event.currentTarget;
    const data = new FormData(form);
    const email = String(data.get("email") ?? "").trim().toLowerCase();
    const password = String(data.get("password") ?? "");
    const name = String(data.get("name") ?? "").trim() || email.split("@")[0] || "所有者";

    if (mode === "signup" && password !== String(data.get("confirmPassword") ?? "")) {
      showMessage("两次输入的密码不一致。");
      return;
    }

    setPending(true);
    showMessage(null);

    const result =
      mode === "signup"
        ? await authClient.signUp.email({ email, password, name, callbackURL: "/auth/verified" })
        : await authClient.signIn.email({ email, password, callbackURL: "/auth/verified" });

    if (result.error) {
      if (isEmailNotVerified(result.error.message)) {
        setVerificationEmail(email);
        setVerificationSent(false);
        setCooldown(60);
      }
      showMessage(friendlyAuthError(result.error.message));
      setPending(false);
      return;
    }

    setPending(false);
    if (mode === "signup") {
      form.reset();
      setVerificationEmail(email);
      setVerificationSent(true);
      setCooldown(60);
      return;
    }
    window.location.assign(next);
  }

  async function resend() {
    if (!verificationEmail || !signupReady || cooldown > 0 || resendPending) return;
    setResendPending(true);
    showMessage(null);

    const result = await authClient.sendVerificationEmail({
      email: verificationEmail,
      callbackURL: "/auth/verified",
    });

    setResendPending(false);
    if (result.error) {
      showMessage(friendlyAuthError(result.error.message));
      return;
    }
    showMessage("验证邮件已重新发送，请查收（包括垃圾邮件）。", "success");
    setCooldown(60);
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
            认证尚未配置。请在 <code className="font-mono">.env.local</code> 中配置数据库和{" "}
            <code className="font-mono">BETTER_AUTH_SECRET</code>。
          </Notice>
        )}
        {envReady && !signupReady && mode === "signup" && (
          <Notice tone="warn">
            邮箱验证尚未配置。注册需要 SMTP，请在 <code className="font-mono">.env.local</code> 中配置{" "}
            <code className="font-mono">SMTP_*</code> 和 <code className="font-mono">EMAIL_FROM</code>。
          </Notice>
        )}
        {message && <Notice tone={messageTone}>{message}</Notice>}
        {!verificationSent && mode === "signin" && verificationEmail && signupReady && (
          <button
            type="button"
            onClick={resend}
            disabled={resendPending || cooldown > 0}
            className="mt-2 text-[12.5px] font-bold text-[#1d6ff4] underline underline-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {resendPending ? "发送中…" : cooldown > 0 ? `重新发送验证邮件（${cooldown}s）` : "重新发送验证邮件"}
          </button>
        )}

        {verificationSent ? (
          <div className="mt-5 rounded-[12px] border-2 border-ink/70 bg-chip-sky px-4 py-4">
            <div className="flex items-center gap-2">
              <MailCheck className="size-5 text-status-working" />
              <h2 className="text-[16px] font-extrabold text-ink">检查你的邮箱</h2>
            </div>
            <p className="mt-2 text-[13.5px] leading-relaxed text-ink/80">
              如果该邮箱可以注册，验证邮件会发送到 <strong className="break-all">{verificationEmail}</strong>。
              点击邮件里的链接完成注册，链接 1 小时内有效。
            </p>
            <button
              type="button"
              onClick={resend}
              disabled={resendPending || cooldown > 0}
              className="fn-sticker mt-4 h-11 w-full justify-center bg-field text-[13px]"
            >
              {resendPending ? <Loader2 className="size-4 animate-spin" /> : <MailCheck className="size-4" />}
              {resendPending ? "发送中…" : cooldown > 0 ? `重新发送（${cooldown}s）` : "重新发送验证邮件"}
            </button>
            <button
              type="button"
              onClick={backToSignIn}
              className="mt-3 w-full text-center text-[12.5px] font-bold text-ink/70 underline underline-offset-2"
            >
              返回登录
            </button>
          </div>
        ) : (
          <>
            <div className="mt-5 grid grid-cols-2 gap-1 rounded-[12px] border-2 border-ink bg-field p-1">
              <button
                type="button"
                onClick={() => switchMode("signin")}
                className={`rounded-[8px] px-3 py-2 text-[13px] font-bold ${mode === "signin" ? "bg-chip-sky text-ink" : "text-ink/60"}`}
              >
                登录
              </button>
              <button
                type="button"
                onClick={() => switchMode("signup")}
                className={`rounded-[8px] px-3 py-2 text-[13px] font-bold ${mode === "signup" ? "bg-chip-sky text-ink" : "text-ink/60"}`}
              >
                创建账户
              </button>
            </div>

            <form onSubmit={submit} className="mt-4 flex flex-col gap-2.5">
              {mode === "signup" && (
                <>
                  <label htmlFor="name" className="font-mono text-[12.5px] text-ink-muted">名称</label>
                  <Input id="name" name="name" autoComplete="name" placeholder="你的名称" disabled={!envReady || pending || !signupReady} className="h-11 rounded-[12px] border-2 border-ink/80 bg-field px-3 text-[15px]" />
                </>
              )}
              <label htmlFor="email" className="font-mono text-[12.5px] text-ink-muted">邮箱</label>
              <Input id="email" name="email" type="email" autoComplete="email" required placeholder="you@example.com" disabled={!envReady || pending || (mode === "signup" && !signupReady)} className="h-11 rounded-[12px] border-2 border-ink/80 bg-field px-3 text-[15px]" />
              <label htmlFor="password" className="font-mono text-[12.5px] text-ink-muted">密码</label>
              <Input id="password" name="password" type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} minLength={8} required placeholder="至少 8 个字符" disabled={!envReady || pending || (mode === "signup" && !signupReady)} className="h-11 rounded-[12px] border-2 border-ink/80 bg-field px-3 text-[15px]" />
              {mode === "signup" && (
                <>
                  <label htmlFor="confirmPassword" className="font-mono text-[12.5px] text-ink-muted">确认密码</label>
                  <Input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" minLength={8} required placeholder="再次输入密码" disabled={!envReady || pending || !signupReady} className="h-11 rounded-[12px] border-2 border-ink/80 bg-field px-3 text-[15px]" />
                </>
              )}
              <button
                type="submit"
                disabled={!envReady || pending || (mode === "signup" && !signupReady)}
                className="fn-sticker mt-1 h-12 w-full justify-center bg-[#1d6ff4] text-white"
              >
                {pending ? <Loader2 className="size-4.5 animate-spin" /> : mode === "signin" ? <LockKeyhole className="size-4.5" /> : <ArrowRight className="size-4.5" />}
                {pending ? "处理中…" : mode === "signin" ? "登录" : "创建账户"}
              </button>
            </form>
          </>
        )}

        <p className="mt-5 text-center font-mono text-[11.5px] text-ink-muted">
          Bot 不会在未经你批准的情况下发送、支付、发布、删除或合并任何内容。
        </p>
      </section>
    </div>
  );
}

function isEmailNotVerified(message?: string) {
  const text = message?.toLowerCase() ?? "";
  return text.includes("not verified") || text.includes("email not verified");
}

function friendlyAuthError(message?: string) {
  const text = message?.toLowerCase() ?? "";
  if (isEmailNotVerified(message)) return "邮箱尚未验证。验证邮件已发送，请查收（包括垃圾邮件）。";
  if (text.includes("verification email")) return "邮箱验证暂时不可用，请稍后重试。";
  if (text.includes("invalid") && text.includes("password")) return "邮箱或密码不正确。";
  if (text.includes("already") || text.includes("exist")) return "该邮箱已经注册，请直接登录。";
  if (text.includes("password")) return "密码不符合要求，请至少输入 8 个字符。";
  if (text.includes("email")) return "邮箱格式不正确，或者该邮箱暂时无法使用。";
  return "操作失败，请稍后重试。";
}

function Notice({ tone, children }: { tone: "warn" | "error" | "success"; children: React.ReactNode }) {
  const Icon = tone === "success" ? MailCheck : TriangleAlert;
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={
        tone === "warn"
          ? "mt-4 flex gap-2 rounded-[12px] border-2 border-ink/70 bg-honey px-3 py-2.5 text-[13px] text-ink"
          : tone === "success"
            ? "mt-4 flex gap-2 rounded-[12px] border-2 border-status-working/60 bg-status-working/15 px-3 py-2.5 text-[13px] text-ink"
            : "mt-4 flex gap-2 rounded-[12px] border-2 border-[#b5473f]/70 bg-danger-bg px-3 py-2.5 text-[13px] text-ink"
      }
    >
      <Icon className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </p>
  );
}
