import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { MailCheck, TriangleAlert } from "lucide-react";

export const metadata: Metadata = { title: "邮箱验证 · Dotty" };

export default function VerifiedPage({ searchParams }: PageProps<"/auth/verified">) {
  return (
    <main className="lawn-bg grid min-h-dvh place-items-center px-4">
      <Suspense fallback={<VerificationCard />}>
        <VerificationResult searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function VerificationResult({ searchParams }: { searchParams: PageProps<"/auth/verified">["searchParams"] }) {
  const params = await searchParams;
  const raw = params.error;
  const code = Array.isArray(raw) ? raw[0] : raw;
  return <VerificationCard code={code} />;
}

function VerificationCard({ code }: { code?: string }) {
  const failed = Boolean(code);
  const copy = code ? verificationError(code) : null;
  return (
    <section className="w-full max-w-[420px] rounded-[18px] border-2 border-ink bg-panel p-6 shadow-[0_5px_0_0_var(--lip)]">
      <p className="font-mono text-[12px] text-ink-muted">现场笔记 · 邮箱验证</p>
      <div className="mt-2 flex items-center gap-2.5">
        {failed ? (
          <TriangleAlert className="size-6 text-status-error" />
        ) : (
          <MailCheck className="size-6 text-status-working" />
        )}
        <h1 className="text-[22px] font-extrabold text-ink">{copy?.title ?? "邮箱已验证"}</h1>
      </div>
      <p className="mt-3 text-[14px] leading-relaxed text-ink/80">
        {copy?.body ?? "现在可以进入办公室了。验证链接只能使用一次。"}
      </p>
      <Link
        href={failed ? "/auth/login" : "/workspace"}
        className="fn-sticker mt-5 h-11 w-full justify-center bg-[#1d6ff4] text-white"
      >
        {failed ? "返回登录" : "进入办公室"}
      </Link>
    </section>
  );
}

function verificationError(code: string) {
  switch (code) {
    case "TOKEN_EXPIRED":
      return {
        title: "验证链接已过期",
        body: "验证链接在 1 小时后失效。请返回登录，输入邮箱和密码后会重新发送一封验证邮件。",
      };
    case "INVALID_TOKEN":
      return {
        title: "验证链接无效",
        body: "这个链接可能已经使用过，或者内容不完整。请返回登录后重新发送验证邮件。",
      };
    case "USER_NOT_FOUND":
      return {
        title: "找不到对应账号",
        body: "这个验证链接对应的账号已不存在，请重新创建账户。",
      };
    case "INVALID_USER":
      return {
        title: "验证链接不匹配",
        body: "这个链接属于另一个账号。请返回登录，并使用收到验证邮件的账号。",
      };
    default:
      return {
        title: "邮箱验证失败",
        body: "这个链接无法使用。请返回登录后重新发送验证邮件。",
      };
  }
}
