"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Loader2, Play, Trash2 } from "lucide-react";
import { deleteRoutine, runRoutineNow, saveRoutine } from "@/app/(routes)/workspace/routine-actions";
import { useOffice } from "@/components/office/office-provider";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { fieldErrors } from "@/lib/office/schemas";
import { routineSchema } from "@/lib/routines/schema";
import { DAY_NAMES, DEFAULT_SCHEDULE, fromCron, HOUR_STEPS, nextRunAt, toCron, type Schedule, type ScheduleKind } from "@/lib/routines/schedule";
import { cn } from "@/lib/utils";
import { DialogBody, errorClass, FnSelect, formClass, FormFooter, inputClass, labelClass, TeamDialog } from "./form-bits";

const KINDS: Array<{ value: ScheduleKind; label: string }> = [
  { value: "daily", label: "每天" },
  { value: "weekdays", label: "工作日" },
  { value: "weekly", label: "每周一次" },
  { value: "hourly", label: "每隔几小时" },
  { value: "custom", label: "自定义" },
];

/** Every timezone the browser knows, for the timezone field's suggestions. */
function timeZones(): string[] {
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch {
    return ["UTC"];
  }
}

/** Create or edit a routine: a bot runs a prompt on a schedule (each run is a task on the board). */
export function RoutineDialog({ routineId, botId }: { routineId?: string; botId?: string }) {
  const { snapshot, botById, departmentById, openEditor, refreshOffice } = useOffice();
  const routine = routineId ? snapshot.routines.find((r) => r.id === routineId) : undefined;

  const defaultBot = botId ?? snapshot.bots.find((b) => b.role !== "head")?.id ?? snapshot.bots[0]?.id ?? "";
  const defaultZone = snapshot.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
  const [name, setName] = useState(routine?.name ?? "");
  const [bot, setBot] = useState(routine?.botId ?? defaultBot);
  const [schedule, setSchedule] = useState<Schedule>(() => (routine?.cron ? fromCron(routine.cron) : DEFAULT_SCHEDULE));
  const [timezone, setTimezone] = useState(routine?.timezone ?? defaultZone);
  const [prompt, setPrompt] = useState(routine?.prompt ?? "");
  const [enabled, setEnabled] = useState(routine?.enabled ?? true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, startTransition] = useTransition();

  const zones = useMemo(() => timeZones(), []);
  const cron = toCron(schedule);
  const next = useMemo(() => nextRunAt(cron, timezone), [cron, timezone]);
  const nextLabel = useMemo(() => {
    if (!next) return null;
    try {
      return new Intl.DateTimeFormat("zh-CN", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: timezone }).format(next);
    } catch {
      return null;
    }
  }, [next, timezone]);

  const close = () => openEditor(null);
  const clear = (key: string) => setErrors(({ [key]: _removed, ...rest }) => rest); // eslint-disable-line @typescript-eslint/no-unused-vars
  const patch = (p: Partial<Schedule>) => {
    setSchedule((s) => ({ ...s, ...p }));
    clear("cron");
  };
  const setKind = (kind: ScheduleKind) => patch(kind === "custom" ? { kind, cron } : { kind });

  const botItems = snapshot.bots.map((b) => ({
    value: b.id,
    label: `${b.name} · ${b.role}${departmentById.get(b.departmentId) ? ` · ${departmentById.get(b.departmentId)!.name}` : ""}`,
  }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = routineSchema.safeParse({ name, botId: bot, cron, timezone, prompt, enabled });
    if (!parsed.success) return setErrors(fieldErrors(parsed.error));
    startTransition(async () => {
      const res = await saveRoutine(snapshot.workspace.id, routineId ?? null, parsed.data);
      if (!res.ok) {
        toast.error(routine ? "保存例行任务失败" : "添加例行任务失败", { description: res.error });
        return setErrors({ ...(res.fieldErrors ?? {}), form: res.error });
      }
      toast.success(routine ? `${parsed.data.name} 已保存` : `${parsed.data.name} 已添加`, {
        description: enabled && nextLabel ? `下次运行：${nextLabel}` : enabled ? undefined : "当前已关闭，启用后才会运行。",
      });
      close();
      void refreshOffice();
    });
  };

  const runNow = () =>
    startTransition(async () => {
      if (!routineId) return;
      const res = await runRoutineNow(routineId);
      if (!res.ok) return void toast.error("运行失败", { description: res.error });
      toast.success(`${botById.get(bot)?.name ?? "Bot"} 已开始处理`);
      close();
      void refreshOffice();
    });

  const remove = () =>
    startTransition(async () => {
      if (!routineId) return;
      const res = await deleteRoutine(routineId);
      if (!res.ok) return void toast.error("删除例行任务失败", { description: res.error });
      toast.success(`${routine?.name ?? "例行任务"} 已删除`);
      close();
      void refreshOffice();
    });

  return (
    <TeamDialog
      open
      onOpenChange={(o) => !o && close()}
      kicker={routine ? "例行任务设置" : "新建例行任务"}
      title={routine ? `编辑 ${routine.name}` : "添加例行任务"}
      description="Bot 会按计划执行这项工作。每次运行都会在任务看板中生成任务；发送、发布或删除操作仍会等待你批准。"
    >
      <form onSubmit={submit} noValidate className={formClass}>
        <DialogBody>
          <FieldGroup className="gap-5 px-6 py-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field data-invalid={!!errors.name}>
                <FieldLabel htmlFor="routine-name" className={labelClass}>
                  名称
                </FieldLabel>
                <Input
                  id="routine-name"
                  autoFocus
                  maxLength={80}
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    clear("name");
                  }}
                  aria-invalid={!!errors.name}
                  placeholder="例如：每日早报"
                  className={inputClass}
                />
                <FieldError className={errorClass}>{errors.name}</FieldError>
              </Field>
              <Field data-invalid={!!errors.botId}>
                <FieldLabel htmlFor="routine-bot" className={labelClass}>
                  Bot
                </FieldLabel>
                <FnSelect id="routine-bot" value={bot} onChange={(v) => (setBot(v), clear("botId"))} items={botItems} invalid={!!errors.botId} />
                <FieldError className={errorClass}>{errors.botId}</FieldError>
              </Field>
            </div>

            <Field data-invalid={!!errors.prompt}>
              <FieldLabel htmlFor="routine-prompt" className={labelClass}>
                每次要做什么
              </FieldLabel>
              <Textarea
                id="routine-prompt"
                rows={4}
                maxLength={4000}
                value={prompt}
                onChange={(e) => {
                  setPrompt(e.target.value);
                  clear("prompt");
                }}
                aria-invalid={!!errors.prompt}
                placeholder="例如：总结过去 24 小时的未读邮件，并列出需要回复的事项。"
                className="min-h-24 rounded-[10px] border-2 border-ink/70 bg-field text-[14px]"
              />
              <FieldError className={errorClass}>{errors.prompt}</FieldError>
            </Field>

            <FieldSet className="gap-3" data-invalid={!!errors.cron}>
              <FieldLegend className={cn(labelClass, "mb-0")}>运行时间</FieldLegend>
              <div role="radiogroup" aria-label="运行频率" className="flex flex-wrap gap-1.5">
                {KINDS.map((k) => (
                  <button
                    key={k.value}
                    type="button"
                    role="radio"
                    aria-checked={schedule.kind === k.value}
                    onClick={() => setKind(k.value)}
                    className={cn(
                      "h-9 rounded-[10px] border-2 px-3 text-[13.5px] font-bold transition-colors",
                      schedule.kind === k.value ? "border-ink bg-honey shadow-[0_2px_0_0_var(--lip)]" : "border-ink/30 bg-field",
                    )}
                  >
                    {k.label}
                  </button>
                ))}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                {schedule.kind === "weekly" && (
                  <Field>
                    <FieldLabel htmlFor="routine-day" className={labelClass}>
                      星期
                    </FieldLabel>
                    <FnSelect
                      id="routine-day"
                      value={String(schedule.day)}
                      onChange={(d) => patch({ day: Number(d) })}
                      items={DAY_NAMES.map((d, i) => ({ value: String(i), label: d }))}
                    />
                  </Field>
                )}
                {(schedule.kind === "daily" || schedule.kind === "weekdays" || schedule.kind === "weekly") && (
                  <Field>
                    <FieldLabel htmlFor="routine-time" className={labelClass}>
                      时间
                    </FieldLabel>
                    <Input id="routine-time" type="time" value={schedule.time} onChange={(e) => e.target.value && patch({ time: e.target.value })} className={inputClass} />
                  </Field>
                )}
                {schedule.kind === "hourly" && (
                  <Field>
                    <FieldLabel htmlFor="routine-hours" className={labelClass}>
                      每隔
                    </FieldLabel>
                    <FnSelect
                      id="routine-hours"
                      value={String(schedule.everyHours)}
                      onChange={(h) => patch({ everyHours: Number(h) })}
                      items={HOUR_STEPS.map((h) => ({ value: String(h), label: `${h} 小时` }))}
                    />
                  </Field>
                )}
                {schedule.kind === "custom" && (
                  <Field className="sm:col-span-2" data-invalid={!!errors.cron}>
                    <FieldLabel htmlFor="routine-cron" className={labelClass}>
                      cron（分 时 日 月 星期）
                    </FieldLabel>
                    <Input
                      id="routine-cron"
                      value={schedule.cron}
                      onChange={(e) => patch({ cron: e.target.value })}
                      aria-invalid={!!errors.cron}
                      placeholder="30 7 * * 1,3,5"
                      className={cn(inputClass, "font-mono")}
                    />
                  </Field>
                )}
                <Field data-invalid={!!errors.timezone}>
                  <FieldLabel htmlFor="routine-tz" className={labelClass}>
                    时区
                  </FieldLabel>
                  <Input
                    id="routine-tz"
                    list="routine-tz-list"
                    value={timezone}
                    onChange={(e) => {
                      setTimezone(e.target.value);
                      clear("timezone");
                    }}
                    aria-invalid={!!errors.timezone}
                    className={inputClass}
                  />
                  <datalist id="routine-tz-list">
                    {zones.map((z) => (
                      <option key={z} value={z} />
                    ))}
                  </datalist>
                  <FieldError className={errorClass}>{errors.timezone}</FieldError>
                </Field>
              </div>
              <FieldError className={errorClass}>{errors.cron}</FieldError>
              <FieldDescription className="text-[12.5px] text-ink-muted">
                {nextLabel ? `下次运行：${nextLabel}` : "这个计划不会运行，请检查配置。"}
                {schedule.kind === "custom" && cron === "* * * * *" && " · 每分钟运行适合测试，但每次运行都会创建任务并消耗 Token。"}
              </FieldDescription>
            </FieldSet>

            <Field orientation="horizontal" className="items-center gap-2.5">
              <Switch id="routine-on" checked={enabled} onCheckedChange={setEnabled} className="data-checked:bg-status-working" />
              <FieldLabel htmlFor="routine-on" className="text-[14px] font-bold">
                {enabled ? "已启用" : "已关闭 · 保存后不会运行"}
              </FieldLabel>
            </Field>

            {errors.form && (
              <p role="alert" className="rounded-[10px] border-2 border-[#b5473f]/60 bg-danger-bg px-3 py-2 text-[13px]">
                {errors.form}
              </p>
            )}
          </FieldGroup>
        </DialogBody>

        <FormFooter>
          {routine && !confirmDelete && (
            <>
              <button type="button" className="fn-pill text-[#b5473f]" onClick={() => setConfirmDelete(true)}>
                <Trash2 className="size-3.5" /> 删除
              </button>
              <button type="button" disabled={pending} className="fn-pill" onClick={runNow} title="立即运行一次，计划不变">
                <Play className="size-3.5" /> 立即运行
              </button>
            </>
          )}
          {confirmDelete && (
            <span className="flex items-center gap-2 text-[13px]">
              确定删除 {routine?.name}？过去的运行记录会保留在任务看板中。
              <button type="button" disabled={pending} className="fn-pill border-[#b5473f] bg-[#dd6d62] text-white" onClick={remove}>
                确认删除
              </button>
              <button type="button" className="fn-pill" onClick={() => setConfirmDelete(false)}>
                保留
              </button>
            </span>
          )}
          <div className="ml-auto flex gap-2">
            <button type="button" className="fn-sticker h-10" onClick={close}>
              取消
            </button>
            <button type="submit" disabled={pending} className="fn-sticker h-10 bg-[#1d6ff4] text-white">
              {pending && <Loader2 className="size-4 animate-spin" />}
              {routine ? "保存例行任务" : "添加例行任务"}
            </button>
          </div>
        </FormFooter>
      </form>
    </TeamDialog>
  );
}
