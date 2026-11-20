import Link from "next/link";

export default function NotFound() {
  return (
    <main className="lawn-bg grid min-h-dvh place-items-center p-4">
      <div className="flex w-full max-w-[420px] flex-col gap-2 rounded-[14px] border-2 border-ink bg-panel p-6 text-ink shadow-[0_4px_0_0_var(--lip)]">
        <p className="text-[20px] font-extrabold">页面不存在</p>
        <p className="text-[13px] text-ink/75">这个页面或工作空间不存在，或者你没有访问权限。</p>
        <Link href="/workspace" className="fn-pill mt-1 self-start px-3">
          返回办公室
        </Link>
      </div>
    </main>
  );
}
