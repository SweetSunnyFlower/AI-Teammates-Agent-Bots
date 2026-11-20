import Link from "next/link";

export default function LandingPage() {
  return (
    <main className="paper-bg flex min-h-dvh flex-col items-center justify-center gap-6 px-6 text-center">
      <p className="font-mono text-[13px] text-ink-muted">现场笔记 · Dotty</p>
      <h1 className="max-w-xl font-mono text-[44px] leading-[1.05] tracking-tight text-ink">
        在一个迷你办公室里，运行你的 AI Bot 团队。
      </h1>
      <p className="max-w-md text-[16px] leading-relaxed text-ink/80">
        总控 Bot 负责规划，各楼层负责执行；任何发送、支付、发布、删除或合并操作，都必须先经过你的批准。
      </p>
      <div className="flex gap-2">
        <Link href="/auth/login" className="fn-pill border-ink bg-ink px-4 py-2 text-[14px] text-panel hover:bg-ink/85">
          开始使用
        </Link>
        <Link href="/workspace" className="fn-pill px-4 py-2 text-[14px]">
          查看演示办公室
        </Link>
      </div>
    </main>
  );
}
