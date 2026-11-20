"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  deleteWorkspace,
  getWorkspaceSettings,
  saveWorkspaceSettings,
  type WorkspaceSettings,
} from "@/app/(routes)/workspace/workspace-settings-actions";
import { useOffice } from "@/components/office/office-provider";
import { Input } from "@/components/ui/input";
import { inputClass, labelClass } from "@/components/team/form-bits";
import { cn } from "@/lib/utils";
import { LoadingLabel, Skeleton } from "@/components/ui/skeleton";

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

function timeZones(): string[] {
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch {
    return ["UTC"];
  }
}

/** Settings → Workspace: name and icon, daily limits with today's usage, timezone, delete. */
export function WorkspaceTab() {
  const { snapshot } = useOffice();
  const workspaceId = snapshot.workspace.id;
  const { data, isPending, error } = useQuery({
    queryKey: ["workspace-settings", workspaceId],
    queryFn: async () => {
      const res = await getWorkspaceSettings(workspaceId);
      if (!res.ok) throw new Error(res.error);
      return res.settings;
    },
    staleTime: 15_000,
  });

  if (isPending) {
    return (
      <div className="flex flex-col gap-6 px-6 py-5" aria-busy="true">
        <LoadingLabel>正在加载工作空间…</LoadingLabel>
        <div className="flex flex-col gap-2">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-3 w-2/3" />
        </div>
        <div className="grid grid-cols-[88px_minmax(0,1fr)] gap-3">
          <Skeleton className="h-10 rounded-[10px]" />
          <Skeleton className="h-10 rounded-[10px]" />
        </div>
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex gap-4 rounded-[12px] border-2 border-ink/15 p-3">
            <Skeleton className="h-10 w-[150px] shrink-0 rounded-[10px]" />
            <div className="flex flex-1 flex-col justify-end gap-2">
              <Skeleton className="h-3 w-4/5" />
              <Skeleton className="h-2 w-full rounded-full" />
            </div>
          </div>
        ))}
      </div>
    );
  }
  if (error || !data) return <p className="p-6 text-[13px] text-[#b5473f]">{error?.message ?? "无法加载工作空间。"}</p>;
  return <WorkspaceForm key={workspaceId} workspaceId={workspaceId} settings={data} />;
}

function WorkspaceForm({ workspaceId, settings }: { workspaceId: string; settings: WorkspaceSettings }) {
  const { refreshOffice } = useOffice();
  const queryClient = useQueryClient();
  const [pending, startTransition] = useTransition();
  const initial = useMemo(
    () => ({
      name: settings.name,
      icon: settings.icon,
      dailySpendCap: (settings.dailySpendCapCents / 100).toFixed(2),
      dailyEngineeringCap: (settings.dailyEngineeringCapCents / 100).toFixed(2),
      dailyTaskCap: String(settings.dailyTaskCap),
      timezone: settings.timezone,
    }),
    [settings],
  );
  const [form, setForm] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const dirty = (Object.keys(form) as Array<keyof typeof form>).some((k) => form[k] !== saved[k]);
  const zones = useMemo(() => timeZones(), []);
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      const res = await saveWorkspaceSettings(workspaceId, form);
      if (!res.ok) return void toast.error("保存失败", { description: res.error });
      setSaved(form);
      toast.success("工作空间已保存");
      void queryClient.invalidateQueries({ queryKey: ["workspace-settings", workspaceId] });
      await refreshOffice();
    });
  };

  const { today } = settings;
  return (
    <div className="flex flex-col gap-6 px-6 py-5">
      <div>
        <h3 className="text-[17px] font-extrabold">工作空间</h3>
        <p className="text-[13px] text-ink-muted">设置名称、每日额度和时区。每日额度在 UTC 午夜重置。</p>
      </div>

      <form onSubmit={save} className="flex flex-col gap-6">
        <section className="grid grid-cols-[88px_minmax(0,1fr)] gap-3">
          <label className="flex flex-col gap-1.5">
            <span className={labelClass}>图标</span>
            <Input value={form.icon} onChange={set("icon")} maxLength={16} aria-label="工作空间图标" className={cn(inputClass, "text-center text-[18px]")} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={labelClass}>名称</span>
            <Input value={form.name} onChange={set("name")} maxLength={60} className={inputClass} />
          </label>
        </section>

        <section className="flex flex-col gap-3">
          <h4 className="text-[14px] font-bold">每日额度</h4>
          <Limit
            label="费用上限"
            hint="Bot 后台任务和例行任务的总花费。达到上限后，Bot 会休息到第二天。"
            prefix="$"
            value={form.dailySpendCap}
            onChange={set("dailySpendCap")}
            used={today.spentCents}
            cap={Math.round(Number(form.dailySpendCap) * 100)}
            usedLabel={money(today.spentCents)}
          />
          <Limit
            label="工程上限"
            hint={`沙箱代码运行费用，单独计算。每次代码运行最多使用 ${money(settings.perRunCapCents)}。`}
            prefix="$"
            value={form.dailyEngineeringCap}
            onChange={set("dailyEngineeringCap")}
            used={today.engineeringCents}
            cap={Math.round(Number(form.dailyEngineeringCap) * 100)}
            usedLabel={money(today.engineeringCents)}
          />
          <Limit
            label="任务上限"
            hint="每天可创建的任务数，包括 Bot 互相分派和例行任务产生的任务。"
            value={form.dailyTaskCap}
            onChange={set("dailyTaskCap")}
            used={today.tasks}
            cap={Number(form.dailyTaskCap)}
            usedLabel={`${today.tasks} 个任务`}
            step={1}
          />
        </section>

        <label className="flex flex-col gap-1.5">
          <span className={labelClass}>你的时区</span>
          <Input value={form.timezone} onChange={set("timezone")} list="workspace-tz-list" className={cn(inputClass, "max-w-[320px]")} />
          <datalist id="workspace-tz-list">
            {zones.map((z) => (
              <option key={z} value={z} />
            ))}
          </datalist>
          <span className="text-[12.5px] text-ink-muted">用于新建例行任务和 Bot 提到的具体时间。</span>
        </label>

        <div className="flex items-center gap-2">
          <button type="submit" disabled={!dirty || pending} className="fn-pill border-ink bg-ink px-4 text-panel hover:bg-ink/85 disabled:opacity-50">
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : null} 保存修改
          </button>
          {dirty && !pending ? (
            <button type="button" onClick={() => setForm(saved)} className="fn-pill px-3">
              撤销
            </button>
          ) : null}
        </div>
      </form>

      <DangerZone workspaceId={workspaceId} name={saved.name} />
    </div>
  );
}

function Limit({
  label,
  hint,
  prefix,
  value,
  onChange,
  used,
  cap,
  usedLabel,
  step = 0.5,
}: {
  label: string;
  hint: string;
  prefix?: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  used: number;
  cap: number;
  usedLabel: string;
  step?: number;
}) {
  const ratio = cap > 0 ? Math.min(1, used / cap) : used > 0 ? 1 : 0;
  const full = cap <= used;
  return (
    <div className="grid gap-x-4 gap-y-1.5 rounded-[12px] border-2 border-ink/20 bg-field p-3 sm:grid-cols-[150px_minmax(0,1fr)]">
      <label className="flex flex-col gap-1.5">
        <span className={labelClass}>{label}</span>
        <span className="relative">
          {prefix ? <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[14.5px] text-ink-muted">{prefix}</span> : null}
          <Input type="number" inputMode="decimal" min={0} max={1000} step={step} value={value} onChange={onChange} className={cn(inputClass, prefix && "pl-6")} />
        </span>
      </label>
      <div className="flex min-w-0 flex-col justify-end gap-1.5">
        <p className="text-[12.5px] text-ink/75">{hint}</p>
        <div className="flex items-center gap-2">
          <span
            className="h-2 flex-1 overflow-hidden rounded-full bg-ink/10"
            role="meter"
            aria-label={`${label}今日已用`}
            aria-valuemin={0}
            aria-valuemax={Math.max(cap, 0)}
            aria-valuenow={used}
          >
            <span className={cn("block h-full rounded-full", full ? "bg-[#dd6d62]" : "bg-ink/70")} style={{ width: `${ratio * 100}%` }} />
          </span>
          <span className={cn("shrink-0 font-mono text-[11.5px]", full ? "text-[#b5473f]" : "text-ink-muted")}>
            今日 {usedLabel}{full ? " · 已达上限" : ""}
          </span>
        </div>
      </div>
    </div>
  );
}

function DangerZone({ workspaceId, name }: { workspaceId: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const remove = () =>
    startTransition(async () => {
      const res = await deleteWorkspace(workspaceId, typed);
      if (!res.ok) return void toast.error("删除失败", { description: res.error });
      toast.success(`${name} 已删除`);
      // /workspace picks another workspace (or the setup page).
      router.replace("/workspace");
    });

  return (
    <section className="flex flex-col gap-2 rounded-[12px] border-2 border-[#dd6d62]/60 p-3">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <h4 className="text-[14px] font-bold">删除工作空间</h4>
          <p className="text-[12.5px] text-ink/75">会删除其中的 Bot、任务、聊天、例行任务和连接，且无法恢复。</p>
        </div>
        {!open ? (
          <button type="button" onClick={() => setOpen(true)} className="fn-pill shrink-0 px-3 text-[#b5473f]">
            <Trash2 className="size-3.5" /> 删除…
          </button>
        ) : null}
      </div>
      {open ? (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={`输入“${name}”以确认`}
            aria-label="输入工作空间名称确认"
            className={cn(inputClass, "max-w-[280px] flex-1")}
            autoFocus
          />
          <button type="button" onClick={remove} disabled={pending || typed.trim() !== name} className="fn-pill border-[#b5473f] bg-[#dd6d62] px-3 text-white disabled:opacity-50">
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : null} 永久删除
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setTyped("");
            }}
            className="fn-pill px-3"
          >
            保留
          </button>
        </div>
      ) : null}
    </section>
  );
}
