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
  { value: "daily", label: "Every day" },
  { value: "weekdays", label: "Weekdays" },
  { value: "weekly", label: "Once a week" },
  { value: "hourly", label: "Every few hours" },
  { value: "custom", label: "Custom" },
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
      return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: timezone }).format(next);
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
        toast.error(routine ? "Couldn't save the routine" : "Couldn't add the routine", { description: res.error });
        return setErrors({ ...(res.fieldErrors ?? {}), form: res.error });
      }
      toast.success(routine ? `${parsed.data.name} saved` : `${parsed.data.name} added`, {
        description: enabled && nextLabel ? `Next run: ${nextLabel}` : enabled ? undefined : "It's off until you switch it on.",
      });
      close();
      void refreshOffice();
    });
  };

  const runNow = () =>
    startTransition(async () => {
      if (!routineId) return;
      const res = await runRoutineNow(routineId);
      if (!res.ok) return void toast.error("Couldn't run it", { description: res.error });
      toast.success(`${botById.get(bot)?.name ?? "The bot"} is on it`);
      close();
      void refreshOffice();
    });

  const remove = () =>
    startTransition(async () => {
      if (!routineId) return;
      const res = await deleteRoutine(routineId);
      if (!res.ok) return void toast.error("Couldn't delete the routine", { description: res.error });
      toast.success(`${routine?.name ?? "Routine"} deleted`);
      close();
      void refreshOffice();
    });

  return (
    <TeamDialog
      open
      onOpenChange={(o) => !o && close()}
      kicker={routine ? "routine settings" : "new routine"}
      title={routine ? `Edit ${routine.name}` : "Add a routine"}
      description="A bot does this on a schedule. Each run shows up as a task on the board, and anything that sends, posts or deletes still waits for your OK."
    >
      <form onSubmit={submit} noValidate className={formClass}>
        <DialogBody>
          <FieldGroup className="gap-5 px-6 py-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field data-invalid={!!errors.name}>
                <FieldLabel htmlFor="routine-name" className={labelClass}>
                  name
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
                  placeholder="e.g. Morning brief"
                  className={inputClass}
                />
                <FieldError className={errorClass}>{errors.name}</FieldError>
              </Field>
              <Field data-invalid={!!errors.botId}>
                <FieldLabel htmlFor="routine-bot" className={labelClass}>
                  bot
                </FieldLabel>
                <FnSelect id="routine-bot" value={bot} onChange={(v) => (setBot(v), clear("botId"))} items={botItems} invalid={!!errors.botId} />
                <FieldError className={errorClass}>{errors.botId}</FieldError>
              </Field>
            </div>

            <Field data-invalid={!!errors.prompt}>
              <FieldLabel htmlFor="routine-prompt" className={labelClass}>
                what to do each time
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
                placeholder="e.g. Summarise my unread emails from the last 24 hours and list anything that needs a reply."
                className="min-h-24 rounded-[10px] border-2 border-ink/70 bg-field text-[14px]"
              />
              <FieldError className={errorClass}>{errors.prompt}</FieldError>
            </Field>

            <FieldSet className="gap-3" data-invalid={!!errors.cron}>
              <FieldLegend className={cn(labelClass, "mb-0")}>when</FieldLegend>
              <div role="radiogroup" aria-label="How often" className="flex flex-wrap gap-1.5">
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
                      day
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
                      time
                    </FieldLabel>
                    <Input id="routine-time" type="time" value={schedule.time} onChange={(e) => e.target.value && patch({ time: e.target.value })} className={inputClass} />
                  </Field>
                )}
                {schedule.kind === "hourly" && (
                  <Field>
                    <FieldLabel htmlFor="routine-hours" className={labelClass}>
                      every
                    </FieldLabel>
                    <FnSelect
                      id="routine-hours"
                      value={String(schedule.everyHours)}
                      onChange={(h) => patch({ everyHours: Number(h) })}
                      items={HOUR_STEPS.map((h) => ({ value: String(h), label: h === 1 ? "hour" : `${h} hours` }))}
                    />
                  </Field>
                )}
                {schedule.kind === "custom" && (
                  <Field className="sm:col-span-2" data-invalid={!!errors.cron}>
                    <FieldLabel htmlFor="routine-cron" className={labelClass}>
                      cron (minute hour day month weekday)
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
                    timezone
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
                {nextLabel ? `Next run: ${nextLabel}` : "This schedule doesn't run — check it."}
                {schedule.kind === "custom" && cron === "* * * * *" && " · every minute is handy for testing, but each run is a task and costs tokens."}
              </FieldDescription>
            </FieldSet>

            <Field orientation="horizontal" className="items-center gap-2.5">
              <Switch id="routine-on" checked={enabled} onCheckedChange={setEnabled} className="data-checked:bg-status-working" />
              <FieldLabel htmlFor="routine-on" className="text-[14px] font-bold">
                {enabled ? "On" : "Off — saved but won't run"}
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
                <Trash2 className="size-3.5" /> Delete
              </button>
              <button type="button" disabled={pending} className="fn-pill" onClick={runNow} title="Run it once now; the schedule stays the same">
                <Play className="size-3.5" /> Run now
              </button>
            </>
          )}
          {confirmDelete && (
            <span className="flex items-center gap-2 text-[13px]">
              Delete {routine?.name}? Past runs stay on the board.
              <button type="button" disabled={pending} className="fn-pill border-[#b5473f] bg-[#dd6d62] text-white" onClick={remove}>
                Yes, delete
              </button>
              <button type="button" className="fn-pill" onClick={() => setConfirmDelete(false)}>
                Keep
              </button>
            </span>
          )}
          <div className="ml-auto flex gap-2">
            <button type="button" className="fn-sticker h-10" onClick={close}>
              Cancel
            </button>
            <button type="submit" disabled={pending} className="fn-sticker h-10 bg-[#1d6ff4] text-white">
              {pending && <Loader2 className="size-4 animate-spin" />}
              {routine ? "Save routine" : "Add routine"}
            </button>
          </div>
        </FormFooter>
      </form>
    </TeamDialog>
  );
}
