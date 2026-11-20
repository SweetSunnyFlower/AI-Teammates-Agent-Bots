"use client";

import { useActionState, useState, useSyncExternalStore } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { ArrowRight, Loader2 } from "lucide-react";
import { createWorkspace, type CreateWorkspaceState } from "@/app/(routes)/workspace/actions";
import { BotAvatar } from "@/components/office/bot-avatar";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { FLOOR_PALETTE } from "@/lib/office/floors";
import { WORKSPACE_ICONS } from "@/lib/office/workspace-icons";
import type { Bot } from "@/lib/office/types";

const STARTER_FLOORS: Array<{ tag: string; bots: Array<Pick<Bot, "name" | "status" | "avatar">> }> = [
  { tag: "4F · 总控办公室", bots: [{ name: "幕僚长", status: "working", avatar: { shape: "sphere", color: "#5c8fd6" } }] },
  {
    tag: "3F · 助理",
    bots: [
      { name: "收件箱助手", status: "working", avatar: { shape: "sphere", color: "#e3a857" } },
      { name: "每日简报", status: "resting", avatar: { shape: "cube", color: "#7fb5a0" } },
    ],
  },
  {
    tag: "2F · 研究",
    bots: [
      { name: "研究员", status: "working", avatar: { shape: "diamond", color: "#8e7cc3" } },
      { name: "价格监控", status: "resting", avatar: { shape: "capsule", color: "#d9775f" } },
    ],
  },
  {
    tag: "1F · 工程",
    bots: [
      { name: "技术主管", status: "working", avatar: { shape: "cube", color: "#3b3a45" } },
      { name: "工程师", status: "resting", avatar: { shape: "capsule", color: "#5c8fd6" } },
    ],
  },
];

const noop = () => () => {};

/** Name + icon for a new workspace, with a preview of the starter building it comes with. */
export function CreateWorkspaceCard({ firstTime, cancelHref }: { firstTime: boolean; cancelHref?: string }) {
  const [state, formAction] = useActionState<CreateWorkspaceState, FormData>(createWorkspace, {});
  const [icon, setIcon] = useState(state.icon ?? WORKSPACE_ICONS[0]);
  const [name, setName] = useState(state.name ?? "");
  const timezone = useSyncExternalStore(noop, () => Intl.DateTimeFormat().resolvedOptions().timeZone, () => "");

  return (
    <div className="grid w-full max-w-[880px] gap-5 md:grid-cols-[1fr_340px]">
      <section className="rounded-[18px] border-2 border-ink bg-panel p-6 shadow-[0_5px_0_0_var(--lip)] sm:p-7">
        <p className="font-mono text-[12px] text-ink-muted">现场笔记 · {firstTime ? "欢迎" : "新建工作空间"}</p>
        <h1 className="mt-1 text-[26px] leading-tight font-extrabold text-ink">
          {firstTime ? "来搭建你的办公室" : "创建新办公室"}
        </h1>
        <p className="mt-2 text-[14px] leading-relaxed text-ink/80">
          一个工作空间就是一栋办公楼。它会自带顶层总控 Bot 和三个初始部门，之后还可以继续添加。
        </p>

        <form action={formAction} className="mt-5 flex flex-col gap-4">
          <input type="hidden" name="icon" value={icon} />
          <input type="hidden" name="timezone" value={timezone} />

          <div className="flex flex-col gap-1.5">
            <label htmlFor="ws-name" className="font-mono text-[12.5px] text-ink-muted">
              工作空间名称
            </label>
            <Input
              id="ws-name"
              name="name"
              required
              maxLength={60}
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：我的 AI 团队"
              className="h-11 rounded-[12px] border-2 border-ink/80 bg-field px-3 text-[15px]"
            />
          </div>

          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1.5 font-mono text-[12.5px] text-ink-muted">图标</legend>
            <div className="grid grid-cols-8 gap-1.5">
              {WORKSPACE_ICONS.map((i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setIcon(i)}
                  aria-pressed={icon === i}
                  aria-label={`使用 ${i} 作为图标`}
                  className={cn(
                    "grid aspect-square place-items-center rounded-[10px] border-2 text-[20px] leading-none transition-transform hover:-translate-y-0.5",
                    icon === i ? "border-ink bg-honey shadow-[0_2px_0_0_var(--lip)]" : "border-ink/25 bg-field",
                  )}
                >
                  {i}
                </button>
              ))}
            </div>
          </fieldset>

          {state.error && (
            <p role="alert" className="rounded-[12px] border-2 border-[#b5473f]/60 bg-danger-bg px-3 py-2 text-[13px] text-ink">
              {state.error}
            </p>
          )}

          <div className="flex items-center gap-2.5">
            <SubmitButton />
            {cancelHref && (
              <Link href={cancelHref} className="fn-sticker h-12">
                取消
              </Link>
            )}
          </div>
        </form>
      </section>

      <aside className="rounded-[18px] border-2 border-ink bg-panel p-5 shadow-[0_5px_0_0_var(--lip)]" aria-label="预览">
        <p className="font-mono text-[12px] text-ink-muted">预览</p>
        <div className="mt-2 flex items-center gap-2.5">
          <span className="grid size-10 place-items-center rounded-[10px] border-2 border-ink bg-chip-sky text-[20px] leading-none">{icon}</span>
          <span className="truncate text-[19px] font-extrabold text-ink">{name.trim() || "你的工作空间"}</span>
        </div>
        <ul className="mt-4 flex flex-col gap-2">
          {STARTER_FLOORS.map((floor, i) => (
            <li
              key={floor.tag}
              className="flex items-center gap-2 rounded-[12px] border-2 border-ink/70 px-3 py-2"
              style={{ backgroundColor: FLOOR_PALETTE[i].chip }}
            >
              <span className="flex-1 font-mono text-[12.5px] text-[#2b2620]">{floor.tag}</span>
              <span className="flex -space-x-1.5">
                {floor.bots.map((b) => (
                  <BotAvatar key={b.name} bot={b} size={28} />
                ))}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-3 font-mono text-[11.5px] text-ink-muted">7 个 Bot · 给总控 Bot 分配任务后才会开始工作。</p>
      </aside>
    </div>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="fn-sticker h-12 flex-1 justify-center bg-[#1d6ff4] text-white">
      {pending ? <Loader2 className="size-4.5 animate-spin" /> : <ArrowRight className="size-4.5" />}
      {pending ? "正在搭建办公室…" : "创建工作空间"}
    </button>
  );
}
