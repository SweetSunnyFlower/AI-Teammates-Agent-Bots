"use client";

import { useMemo, useState, useTransition } from "react";
import { Crown, Loader2, Plug, Trash2 } from "lucide-react";
import { deleteBot, saveBot } from "@/app/(routes)/workspace/team-actions";
import { BotAvatar } from "@/components/office/bot-avatar";
import { useOffice } from "@/components/office/office-provider";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { AVATAR_SHAPES, BOT_MODELS, botSchema, fieldErrors, type BotInput } from "@/lib/office/schemas";
import { defaultToolsFor, TOOL_CATALOG, TOOL_KEYS, toolsForRole } from "@/lib/office/tools";
import { ALL_APPS, defaultAppKeys, hasAllApps } from "@/lib/integrations/app-access";
import type { BotRole } from "@/lib/office/types";
import { DialogBody, errorClass, FnSelect, formClass, FormFooter, inputClass, labelClass, Swatches, TeamDialog } from "./form-bits";
import { useConnectedApps } from "./use-connected-apps";
import { toast } from "sonner";

const BOT_COLORS = ["#5c8fd6", "#e3a857", "#8e7cc3", "#7fb5a0", "#d9775f", "#e58fa6", "#b6c46a", "#3b3a45", "#2bb3b8", "#f07b6b"];
const SHAPE_LABEL: Record<(typeof AVATAR_SHAPES)[number], string> = {
  sphere: "圆形",
  cube: "方形",
  capsule: "高挑",
  cylinder: "圆柱",
  cone: "锥形",
  diamond: "菱形",
};

/** Create or edit a bot. The Head bot can be renamed/restyled but keeps its role and floor. */
export function BotDialog({ botId, departmentId }: { botId?: string; departmentId?: string }) {
  const { snapshot, botById, departmentById, botsByFloor, floors, openEditor, selectBot, openSettings } = useOffice();
  const { refreshOffice } = useOffice();
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
      tools: bot ? bot.tools.filter((t) => TOOL_KEYS.has(t)) : defaultToolsFor(role),
      apps: bot?.apps ?? defaultAppKeys(role),
      model: bot?.model ?? "deepseek-chat",
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

  // Connected apps load in the background (cached), so the dialog opens at once and saving never waits.
  const live = snapshot.workspace.id !== "demo";
  const connectedApps = useConnectedApps(snapshot.workspace.id, live);
  const connected = connectedApps.data?.apps ?? [];
  const allApps = hasAllApps(values.apps);
  // Apps this bot has that aren't connected any more stay listed, so they can be unticked.
  const appRows = [
    ...connected.map((a) => ({ ...a, connected: true })),
    ...values.apps
      .filter((slug) => slug !== ALL_APPS && !connected.some((a) => a.slug === slug))
      .map((slug) => ({ slug, name: slug, logo: null, connected: false })),
  ];
  const setAllApps = (on: boolean) => set("apps", on ? [ALL_APPS] : connected.map((a) => a.slug));
  const toggleApp = (slug: string, on: boolean) =>
    set("apps", on ? [...new Set([...values.apps.filter((k) => k !== ALL_APPS), slug])] : values.apps.filter((k) => k !== slug && k !== ALL_APPS));
  const goConnect = () => {
    close();
    openSettings("connectors");
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = botSchema.safeParse(values);
    if (!parsed.success) return setErrors(fieldErrors(parsed.error));
    startTransition(async () => {
      const res = await saveBot(snapshot.workspace.id, botId ?? null, parsed.data);
      if (!res.ok) {
        toast.error(bot ? "保存 Bot 失败" : "添加 Bot 失败", { description: res.error });
        return setErrors({ ...(res.fieldErrors ?? {}), form: res.error });
      }
      toast.success(bot ? `${parsed.data.name} 已保存` : `${parsed.data.name} 已加入团队`);
      close();
      void refreshOffice();
    });
  };

  const remove = () =>
    startTransition(async () => {
      if (!botId) return;
      const res = await deleteBot(snapshot.workspace.id, botId);
      if (!res.ok) {
        toast.error("删除 Bot 失败", { description: res.error });
        return setErrors({ form: res.error });
      }
      toast.success(`${bot?.name ?? "Bot"} 已删除`);
      selectBot(null);
      close();
      void refreshOffice();
    });

  const groups = [...new Set(TOOL_CATALOG.map((t) => t.group))];

  return (
    <TeamDialog
      open
      onOpenChange={(o) => !o && close()}
      wide
      kicker={bot ? `${isHead ? "总控 Bot" : bot.role === "lead" ? "主管 Bot" : "执行 Bot"} · Bot 设置` : "新建 Bot"}
      title={bot ? `编辑 ${bot.name}` : "添加 Bot"}
      description={isHead ? "总控 Bot 负责规划整个办公室的工作。它始终位于总控办公室楼层，不能删除。" : undefined}
    >
      <form onSubmit={submit} noValidate className={formClass}>
        <DialogBody>
        <div className="grid gap-5 px-6 py-5 sm:grid-cols-[1fr_150px]">
          <FieldGroup className="gap-5">
            <Field data-invalid={!!errors.name}>
              <FieldLabel htmlFor="bot-name" className={labelClass}>
                名称
              </FieldLabel>
              <Input
                id="bot-name"
                autoFocus
                maxLength={60}
                value={values.name}
                onChange={(e) => set("name", e.target.value)}
                aria-invalid={!!errors.name}
                placeholder="例如：发票跟进助手"
                className={inputClass}
              />
              <FieldError className={errorClass}>{errors.name}</FieldError>
            </Field>

            {isHead ? (
              <p className="flex items-center gap-2 rounded-[10px] bg-panel-sunken px-3 py-2 text-[13px]">
                <Crown className="size-4 text-[#d49a52]" /> 总控 Bot · {floor?.name ?? "总控办公室"}（顶层）
              </p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field data-invalid={!!errors.departmentId}>
                  <FieldLabel htmlFor="bot-floor" className={labelClass}>
                    楼层
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
                  <FieldLabel className={labelClass}>角色</FieldLabel>
                  <div role="radiogroup" aria-label="角色" className="grid grid-cols-2 gap-1.5">
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
                          {r === "lead" ? "主管" : "执行"}
                        </button>
                      );
                    })}
                  </div>
                </Field>
                <FieldDescription className="text-[12.5px] text-ink-muted sm:col-span-2">
                  {onHeadFloor
                    ? "总控办公室由总控 Bot 负责，这里的其他 Bot 都是执行角色。"
                    : values.role === "lead" && currentLead
                      ? `将替换 ${currentLead.name} 成为本层主管，原主管会转为执行角色。`
                      : "每个楼层有一个主管，可以向办公室里的任意 Bot 分派任务。"}
                </FieldDescription>
              </div>
            )}

            <FieldSet className="gap-2">
              <FieldLegend className={cn(labelClass, "mb-1")}>外观</FieldLegend>
              <div role="radiogroup" aria-label="外观形状" className="grid grid-cols-6 gap-1.5">
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
              <Swatches label="颜色" colors={BOT_COLORS} value={values.color} onChange={(c) => set("color", c)} />
            </FieldSet>
          </FieldGroup>

          <div className="flex flex-col items-center gap-2 rounded-[14px] border-2 border-ink/20 bg-field p-3 sm:self-start">
            <BotAvatar bot={{ name: values.name || "新 Bot", status: "working", avatar: { shape: values.shape, color: values.color } }} size={110} animated />
            <p className="max-w-full truncate text-center text-[14px] font-extrabold">{values.name.trim() || "新 Bot"}</p>
            <p className="font-mono text-[11px] text-ink-muted">{isHead ? "总控" : values.role === "lead" ? "主管" : "执行"}</p>
          </div>
        </div>

        <FieldGroup className="gap-5 border-t border-hairline px-6 py-5">
          <Field data-invalid={!!errors.instructions}>
            <FieldLabel htmlFor="bot-instructions" className={labelClass}>
              这个 Bot 负责什么
            </FieldLabel>
            <Textarea
              id="bot-instructions"
              rows={4}
              maxLength={4000}
              value={values.instructions}
              onChange={(e) => set("instructions", e.target.value)}
              aria-invalid={!!errors.instructions}
              placeholder="例如：每周一跟进未付款发票，起草礼貌提醒，并在发送前征求我的同意。"
              className="min-h-24 rounded-[10px] border-2 border-ink/70 bg-field text-[14px]"
            />
            <FieldError className={errorClass}>{errors.instructions}</FieldError>
          </Field>

          <Field>
            <FieldLabel htmlFor="bot-model" className={labelClass}>
              模型
            </FieldLabel>
            <FnSelect id="bot-model" value={values.model} onChange={(m) => set("model", m)} items={BOT_MODELS} />
          </Field>

          <FieldSet className="gap-3" data-invalid={!!errors.tools}>
            <FieldLegend className={cn(labelClass, "mb-0")}>工具</FieldLegend>
            <FieldDescription className="-mt-2 text-[12.5px] text-ink-muted">
              标记为“<span className="rounded-full bg-honey px-1.5">需要审批</span>”的工具会先等待你确认。
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
                          {t.gated && <span className="rounded-full bg-honey px-1.5 font-mono text-[10.5px]">需要审批</span>}
                        </FieldLabel>
                      </Field>
                    ))}
                  </div>
                </div>
              );
            })}
            <FieldError className={errorClass}>{errors.tools}</FieldError>
          </FieldSet>

          <FieldSet className="gap-3" data-invalid={!!errors.apps}>
            <FieldLegend className={cn(labelClass, "mb-0")}>应用</FieldLegend>
            <FieldDescription className="-mt-2 text-[12.5px] text-ink-muted">
              应用在“设置 → 连接器”中连接。发送、发布和删除操作都会先等待你确认。如果 Bot 需要使用尚未获得权限的应用，它会在“待我处理”中向你申请。
            </FieldDescription>

            <Field orientation="horizontal" className="items-center gap-2">
              <Checkbox
                id="app-all"
                checked={allApps}
                onCheckedChange={(c) => setAllApps(c === true)}
                className="border-ink/60 data-checked:border-ink data-checked:bg-ink"
              />
              <FieldLabel htmlFor="app-all" className="text-[13.5px] font-bold">
                所有已连接应用
                <span className="font-mono text-[10.5px] font-normal text-ink-muted">包含以后连接的应用</span>
              </FieldLabel>
            </Field>

            {live && connectedApps.isPending ? (
              <p className="flex items-center gap-2 text-[13px] text-ink-muted">
                <Loader2 className="size-3.5 animate-spin" /> 正在加载已连接应用…
              </p>
            ) : appRows.length === 0 ? (
              <div className="flex flex-wrap items-center gap-2 rounded-[10px] bg-panel-sunken px-3 py-2 text-[13px]">
                <span className="min-w-0 flex-1">
                  {connectedApps.data?.error && !connectedApps.data.setup
                    ? connectedApps.data.error
                    : "还没有连接应用。"}{" "}
                  你仍然可以添加这个 Bot，连接应用后它会自动获得访问权限。
                </span>
                {live && (
                  <button type="button" className="fn-pill" onClick={goConnect}>
                    <Plug className="size-3.5" /> 连接应用
                  </button>
                )}
              </div>
            ) : (
              <div className="grid gap-1.5 sm:grid-cols-2">
                {appRows.map((app) => (
                  <Field key={app.slug} orientation="horizontal" className="items-center gap-2">
                    <Checkbox
                      id={`app-${app.slug}`}
                      checked={allApps ? app.connected : values.apps.includes(app.slug)}
                      disabled={allApps}
                      onCheckedChange={(c) => toggleApp(app.slug, c === true)}
                      className="border-ink/60 data-checked:border-ink data-checked:bg-ink"
                    />
                    <FieldLabel htmlFor={`app-${app.slug}`} className="min-w-0 text-[13.5px] font-normal">
                      {app.logo ? (
                        // eslint-disable-next-line @next/next/no-img-element -- third-party app logos from Composio's CDN
                        <img src={app.logo} alt="" className="size-4 shrink-0 object-contain" loading="lazy" />
                      ) : null}
                      <span className="truncate">{app.name}</span>
                      {!app.connected && <span className="rounded-full bg-panel-sunken px-1.5 font-mono text-[10.5px]">未连接</span>}
                    </FieldLabel>
                  </Field>
                ))}
              </div>
            )}
            <FieldError className={errorClass}>{errors.apps}</FieldError>
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
              <Trash2 className="size-3.5" /> 删除 Bot
            </button>
          )}
          {confirmDelete && (
            <span className="flex items-center gap-2 text-[13px]">
              确定删除 {bot?.name}？它的笔记和聊天记录也会一起删除。
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
              {bot ? "保存 Bot" : "添加 Bot"}
            </button>
          </div>
        </FormFooter>
      </form>
    </TeamDialog>
  );
}
