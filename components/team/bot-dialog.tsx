"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Crown, Loader2, Trash2 } from "lucide-react";
import { deleteBot, saveBot } from "@/app/(routes)/workspace/team-actions";
import { BotAvatar } from "@/components/office/bot-avatar";
import { useOffice } from "@/components/office/office-provider";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { AVATAR_SHAPES, BOT_MODELS, botSchema, fieldErrors, type BotInput } from "@/lib/office/schemas";
import { defaultToolsFor, TOOL_CATALOG, toolsForRole } from "@/lib/office/tools";
import type { BotRole } from "@/lib/office/types";
import { DialogBody, errorClass, FnSelect, formClass, FormFooter, inputClass, labelClass, Swatches, TeamDialog } from "./form-bits";
import { toast } from "sonner";

const BOT_COLORS = ["#5c8fd6", "#e3a857", "#8e7cc3", "#7fb5a0", "#d9775f", "#e58fa6", "#b6c46a", "#3b3a45", "#2bb3b8", "#f07b6b"];
const SHAPE_LABEL: Record<(typeof AVATAR_SHAPES)[number], string> = {
  sphere: "Round",
  cube: "Boxy",
  capsule: "Tall",
  cylinder: "Can",
  cone: "Cone",
  diamond: "Gem",
};

/** Create or edit a bot. The Head bot can be renamed/restyled but keeps its role and floor. */
export function BotDialog({ botId, departmentId }: { botId?: string; departmentId?: string }) {
  const { snapshot, botById, departmentById, botsByFloor, floors, openEditor, selectBot } = useOffice();
  const router = useRouter();
  const bot = botId ? botById.get(botId) : undefined;
  const isHead = bot?.role === "head";

  // New bots go on the floor they were added from, else the floor under the Head office.
  const firstWorkFloor = floors.find((f) => f.kind !== "head") ?? floors[0];
  const startFloor = bot?.departmentId ?? departmentId ?? firstWorkFloor?.id ?? "";

  const [values, setValues] = useState<BotInput>(() => {
    const role: BotRole = bot?.role ?? "worker";
    return {
      name: bot?.name ?? "",
      departmentId: startFloor,
      role,
      shape: bot?.avatar.shape ?? "sphere",
      color: bot?.avatar.color ?? BOT_COLORS[snapshot.bots.length % BOT_COLORS.length],
      instructions: bot?.instructions ?? "",
      tools: bot?.tools ?? defaultToolsFor(departmentById.get(startFloor)?.kind ?? "custom", role),
      model: bot?.model ?? "claude-sonnet-5-5",
    };
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, startTransition] = useTransition();

  const close = () => openEditor(null);
  const set = <K extends keyof BotInput>(key: K, value: BotInput[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
    setErrors(({ [key]: _, ...rest }) => rest);
  };

  const floor = departmentById.get(values.departmentId);
  const onHeadFloor = floor?.kind === "head";
  const currentLead = (botsByFloor.get(values.departmentId) ?? []).find((b) => b.role === "lead" && b.id !== botId);
  const allowedTools = useMemo(() => new Set(toolsForRole(values.role).map((t) => t.key)), [values.role]);

  const setRole = (role: BotRole) => {
    setValues((v) => ({ ...v, role, tools: v.tools.filter((t) => toolsForRole(role).some((x) => x.key === t)) }));
  };
  const setFloor = (id: string) => {
    setValues((v) => ({
      ...v,
      departmentId: id,
      // The Head office has the Head instead of a Lead.
      role: departmentById.get(id)?.kind === "head" && v.role === "lead" ? "worker" : v.role,
    }));
  };
  const toggleTool = (key: string, on: boolean) =>
    set("tools", on ? [...new Set([...values.tools, key])] : values.tools.filter((t) => t !== key));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = botSchema.safeParse(values);
    if (!parsed.success) return setErrors(fieldErrors(parsed.error));
    startTransition(async () => {
      const res = await saveBot(snapshot.workspace.id, botId ?? null, parsed.data);
      if (!res.ok) {
        toast.error(bot ? "Couldn't save the bot" : "Couldn't add the bot", { description: res.error });
        return setErrors({ ...(res.fieldErrors ?? {}), form: res.error });
      }
      toast.success(bot ? `${parsed.data.name} saved` : `${parsed.data.name} joined the team`);
      close();
      router.refresh();
    });
  };

  const remove = () =>
    startTransition(async () => {
      if (!botId) return;
      const res = await deleteBot(snapshot.workspace.id, botId);
      if (!res.ok) {
        toast.error("Couldn't delete the bot", { description: res.error });
        return setErrors({ form: res.error });
      }
      toast.success(`${bot?.name ?? "Bot"} was removed`);
      selectBot(null);
      close();
      router.refresh();
    });

  const groups = [...new Set(TOOL_CATALOG.map((t) => t.group))];

  return (
    <TeamDialog
      open
      onOpenChange={(o) => !o && close()}
      wide
      kicker={bot ? `${isHead ? "head bot" : bot.role} · bot settings` : "new bot"}
      title={bot ? `Edit ${bot.name}` : "Add a bot"}
      description={isHead ? "The Head bot plans work for the whole building. It always sits on the Head office floor and can't be removed." : undefined}
    >
      <form onSubmit={submit} noValidate className={formClass}>
        <DialogBody>
        <div className="grid gap-5 px-6 py-5 sm:grid-cols-[1fr_150px]">
          <FieldGroup className="gap-5">
            <Field data-invalid={!!errors.name}>
              <FieldLabel htmlFor="bot-name" className={labelClass}>
                name
              </FieldLabel>
              <Input
                id="bot-name"
                autoFocus
                maxLength={60}
                value={values.name}
                onChange={(e) => set("name", e.target.value)}
                aria-invalid={!!errors.name}
                placeholder="e.g. Invoice Chaser"
                className={inputClass}
              />
              <FieldError className={errorClass}>{errors.name}</FieldError>
            </Field>

            {isHead ? (
              <p className="flex items-center gap-2 rounded-[10px] bg-panel-sunken px-3 py-2 text-[13px]">
                <Crown className="size-4 text-[#d49a52]" /> Head bot · {floor?.name ?? "Head office"} (top floor)
              </p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field data-invalid={!!errors.departmentId}>
                  <FieldLabel htmlFor="bot-floor" className={labelClass}>
                    floor
                  </FieldLabel>
                  <FnSelect
                    id="bot-floor"
                    value={values.departmentId}
                    onChange={setFloor}
                    items={floors.map((f) => ({ value: f.id, label: `${f.floorIndex}F · ${f.name}` }))}
                    invalid={!!errors.departmentId}
                  />
                  <FieldError className={errorClass}>{errors.departmentId}</FieldError>
                </Field>

                <Field>
                  <FieldLabel className={labelClass}>role</FieldLabel>
                  <div role="radiogroup" aria-label="Role" className="grid grid-cols-2 gap-1.5">
                    {(["lead", "worker"] as const).map((r) => {
                      const disabled = r === "lead" && onHeadFloor;
                      return (
                        <button
                          key={r}
                          type="button"
                          role="radio"
                          aria-checked={values.role === r}
                          disabled={disabled}
                          onClick={() => setRole(r)}
                          className={cn(
                            "h-10 rounded-[10px] border-2 text-[14px] font-bold capitalize transition-colors disabled:opacity-40",
                            values.role === r ? "border-ink bg-honey shadow-[0_2px_0_0_var(--lip)]" : "border-ink/30 bg-field",
                          )}
                        >
                          {r}
                        </button>
                      );
                    })}
                  </div>
                </Field>
                <FieldDescription className="text-[12.5px] text-ink-muted sm:col-span-2">
                  {onHeadFloor
                    ? "The Head office is led by the Head bot — other bots here are workers."
                    : values.role === "lead" && currentLead
                      ? `Replaces ${currentLead.name} as this floor's Lead (they become a worker).`
                      : "Each floor has one Lead, who can hand tasks to any bot in the building."}
                </FieldDescription>
              </div>
            )}

            <FieldSet className="gap-2">
              <FieldLegend className={cn(labelClass, "mb-1")}>body</FieldLegend>
              <div role="radiogroup" aria-label="Body shape" className="grid grid-cols-6 gap-1.5">
                {AVATAR_SHAPES.map((shape) => (
                  <button
                    key={shape}
                    type="button"
                    role="radio"
                    aria-checked={values.shape === shape}
                    aria-label={SHAPE_LABEL[shape]}
                    title={SHAPE_LABEL[shape]}
                    onClick={() => set("shape", shape)}
                    className={cn(
                      "grid aspect-square place-items-center rounded-[10px] border-2 transition-transform hover:-translate-y-0.5",
                      values.shape === shape ? "border-ink bg-honey shadow-[0_2px_0_0_var(--lip)]" : "border-ink/25 bg-field",
                    )}
                  >
                    <BotAvatar bot={{ name: shape, status: "resting", avatar: { shape, color: values.color } }} size={34} />
                  </button>
                ))}
              </div>
              <Swatches label="Colour" colors={BOT_COLORS} value={values.color} onChange={(c) => set("color", c)} />
            </FieldSet>
          </FieldGroup>

          <div className="flex flex-col items-center gap-2 rounded-[14px] border-2 border-ink/20 bg-field p-3 sm:self-start">
            <BotAvatar bot={{ name: values.name || "New bot", status: "working", avatar: { shape: values.shape, color: values.color } }} size={110} animated />
            <p className="max-w-full truncate text-center text-[14px] font-extrabold">{values.name.trim() || "New bot"}</p>
            <p className="font-mono text-[11px] text-ink-muted">{isHead ? "head" : values.role}</p>
          </div>
        </div>

        <FieldGroup className="gap-5 border-t border-hairline px-6 py-5">
          <Field data-invalid={!!errors.instructions}>
            <FieldLabel htmlFor="bot-instructions" className={labelClass}>
              what this bot does
            </FieldLabel>
            <Textarea
              id="bot-instructions"
              rows={4}
              maxLength={4000}
              value={values.instructions}
              onChange={(e) => set("instructions", e.target.value)}
              aria-invalid={!!errors.instructions}
              placeholder="e.g. Chase unpaid invoices every Monday. Draft polite reminders and ask before sending."
              className="min-h-24 rounded-[10px] border-2 border-ink/70 bg-field text-[14px]"
            />
            <FieldError className={errorClass}>{errors.instructions}</FieldError>
          </Field>

          <Field>
            <FieldLabel htmlFor="bot-model" className={labelClass}>
              model
            </FieldLabel>
            <FnSelect id="bot-model" value={values.model} onChange={(m) => set("model", m)} items={BOT_MODELS} />
          </Field>

          <FieldSet className="gap-3" data-invalid={!!errors.tools}>
            <FieldLegend className={cn(labelClass, "mb-0")}>tools</FieldLegend>
            <FieldDescription className="-mt-2 text-[12.5px] text-ink-muted">
              Tools marked <span className="rounded-full bg-honey px-1.5">needs approval</span> always wait for your OK.
            </FieldDescription>
            {groups.map((group) => {
              const tools = TOOL_CATALOG.filter((t) => t.group === group && allowedTools.has(t.key));
              if (!tools.length) return null;
              return (
                <div key={group}>
                  <p className="mb-1.5 text-[13px] font-bold">{group}</p>
                  <div className="grid gap-1.5 sm:grid-cols-2">
                    {tools.map((t) => (
                      <Field key={t.key} orientation="horizontal" className="items-center gap-2">
                        <Checkbox
                          id={`tool-${t.key}`}
                          checked={values.tools.includes(t.key)}
                          onCheckedChange={(c) => toggleTool(t.key, c === true)}
                          className="border-ink/60 data-checked:border-ink data-checked:bg-ink"
                        />
                        <FieldLabel htmlFor={`tool-${t.key}`} className="text-[13.5px] font-normal">
                          {t.label}
                          {t.gated && <span className="rounded-full bg-honey px-1.5 font-mono text-[10.5px]">needs approval</span>}
                        </FieldLabel>
                      </Field>
                    ))}
                  </div>
                </div>
              );
            })}
            <FieldError className={errorClass}>{errors.tools}</FieldError>
          </FieldSet>

          {errors.form && (
            <p role="alert" className="rounded-[10px] border-2 border-[#b5473f]/60 bg-danger-bg px-3 py-2 text-[13px]">
              {errors.form}
            </p>
          )}
        </FieldGroup>
        </DialogBody>

        <FormFooter>
          {bot && !isHead && !confirmDelete && (
            <button type="button" className="fn-pill text-[#b5473f]" onClick={() => setConfirmDelete(true)}>
              <Trash2 className="size-3.5" /> Delete bot
            </button>
          )}
          {confirmDelete && (
            <span className="flex items-center gap-2 text-[13px]">
              Delete {bot?.name}? Its notes and chats go too.
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
              {bot ? "Save bot" : "Add bot"}
            </button>
          </div>
        </FormFooter>
      </form>
    </TeamDialog>
  );
}
