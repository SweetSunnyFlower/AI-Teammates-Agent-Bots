"use client";

import { useState, useTransition } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { deleteDepartment, saveDepartment } from "@/app/(routes)/workspace/team-actions";
import { useOffice } from "@/components/office/office-provider";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FLOOR_TINTS, floorTint } from "@/lib/office/floors";
import { departmentSchema, fieldErrors, FLOOR_STYLES, type DepartmentInput } from "@/lib/office/schemas";
import { DialogBody, errorClass, FnSelect, formClass, FormFooter, inputClass, labelClass, Swatches, TeamDialog } from "./form-bits";
import { toast } from "sonner";

/** Create or edit a floor; editing also offers delete (move its bots, or delete them too). */
export function DepartmentDialog({ departmentId }: { departmentId?: string }) {
  const { snapshot, departmentById, botsByFloor, openEditor, floors } = useOffice();
  const { refreshOffice } = useOffice();
  const dept = departmentId ? departmentById.get(departmentId) : undefined;
  const isHead = dept?.kind === "head";
  const departments = snapshot.departments;

  const [values, setValues] = useState<DepartmentInput>(() => ({
    name: dept?.name ?? "",
    color: dept ? floorTint(departments, dept.id) : FLOOR_TINTS[(departments.length + 2) % FLOOR_TINTS.length],
    description: dept?.description ?? "",
    kind: dept && dept.kind !== "head" ? dept.kind : "custom",
  }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<"edit" | "delete">("edit");
  const [pending, startTransition] = useTransition();

  const close = () => openEditor(null);
  const set = <K extends keyof DepartmentInput>(key: K, value: DepartmentInput[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
    setErrors(({ [key]: _, ...rest }) => rest);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = departmentSchema.safeParse(values);
    if (!parsed.success) return setErrors(fieldErrors(parsed.error));
    startTransition(async () => {
      const res = await saveDepartment(snapshot.workspace.id, departmentId ?? null, parsed.data);
      if (!res.ok) {
        toast.error(dept ? "保存楼层失败" : "添加楼层失败", { description: res.error });
        return setErrors({ ...(res.fieldErrors ?? {}), form: res.error });
      }
      toast.success(dept ? `${parsed.data.name} 已保存` : `${parsed.data.name}楼层已添加`);
      close();
      void refreshOffice();
    });
  };

  const title = dept ? `编辑 ${dept.name}` : "添加楼层";
  const kicker = dept ? `${dept.floorIndex}F · 楼层设置` : "新楼层 · 位于总控办公室下方";

  if (mode === "delete" && dept) {
    return (
      <DeleteFloor
        departmentId={dept.id}
        name={dept.name}
        botNames={(botsByFloor.get(dept.id) ?? []).map((b) => b.name)}
        targets={floors.filter((f) => f.id !== dept.id).map((f) => ({ value: f.id, label: f.name }))}
        onBack={() => setMode("edit")}
        onDone={() => {
          close();
          void refreshOffice();
        }}
      />
    );
  }

  return (
    <TeamDialog
      open
      onOpenChange={(o) => !o && close()}
      kicker={kicker}
      title={title}
      description={isHead ? "总控办公室始终位于顶层，不能删除。" : undefined}
    >
      <form onSubmit={submit} noValidate className={formClass}>
        <DialogBody>
        <FieldGroup className="gap-5 px-6 py-5">
          <Field data-invalid={!!errors.name}>
            <FieldLabel htmlFor="dept-name" className={labelClass}>
              楼层名称
            </FieldLabel>
            <Input
              id="dept-name"
              autoFocus
              maxLength={40}
              value={values.name}
              onChange={(e) => set("name", e.target.value)}
              aria-invalid={!!errors.name}
              placeholder="例如：市场部"
              className={inputClass}
            />
            <FieldError className={errorClass}>{errors.name}</FieldError>
          </Field>

          <Field>
            <FieldLabel className={labelClass}>玻璃色</FieldLabel>
            <Swatches label="玻璃颜色" colors={FLOOR_TINTS} value={values.color} onChange={(c) => set("color", c)} />
            <FieldError className={errorClass}>{errors.color}</FieldError>
          </Field>

          {!isHead && (
            <Field>
              <FieldLabel htmlFor="dept-kind" className={labelClass}>
                楼层风格
              </FieldLabel>
              <FnSelect id="dept-kind" value={values.kind} onChange={(k) => set("kind", k)} items={FLOOR_STYLES} />
              <FieldDescription className="text-[12.5px] text-ink-muted">这一层的家具样式。</FieldDescription>
            </Field>
          )}

          <Field data-invalid={!!errors.description}>
            <FieldLabel htmlFor="dept-desc" className={labelClass}>
              这个楼层负责什么 <span className="text-ink-muted/70">（可选）</span>
            </FieldLabel>
            <Textarea
              id="dept-desc"
              rows={3}
              maxLength={280}
              value={values.description}
              onChange={(e) => set("description", e.target.value)}
              aria-invalid={!!errors.description}
              placeholder="总控 Bot 分派任务时会参考这段说明。"
              className="min-h-20 rounded-[10px] border-2 border-ink/70 bg-field text-[14px]"
            />
            <FieldError className={errorClass}>{errors.description}</FieldError>
          </Field>

          {errors.form && (
            <p role="alert" className="rounded-[10px] border-2 border-[#b5473f]/60 bg-danger-bg px-3 py-2 text-[13px]">
              {errors.form}
            </p>
          )}
        </FieldGroup>
        </DialogBody>

        <FormFooter>
          {dept && !isHead && (
            <button type="button" className="fn-pill text-[#b5473f]" onClick={() => setMode("delete")}>
              <Trash2 className="size-3.5" /> 删除楼层
            </button>
          )}
          <div className="ml-auto flex gap-2">
            <button type="button" className="fn-sticker h-10" onClick={close}>
              取消
            </button>
            <button type="submit" disabled={pending} className="fn-sticker h-10 bg-[#1d6ff4] text-white">
              {pending && <Loader2 className="size-4 animate-spin" />}
              {dept ? "保存楼层" : "添加楼层"}
            </button>
          </div>
        </FormFooter>
      </form>
    </TeamDialog>
  );
}

function DeleteFloor({
  departmentId,
  name,
  botNames,
  targets,
  onBack,
  onDone,
}: {
  departmentId: string;
  name: string;
  botNames: string[];
  targets: Array<{ value: string; label: string }>;
  onBack: () => void;
  onDone: () => void;
}) {
  const { openEditor } = useOffice();
  const [choice, setChoice] = useState<"move" | "delete">(botNames.length ? "move" : "delete");
  const [target, setTarget] = useState(targets[0]?.value ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const confirm = () =>
    startTransition(async () => {
      const res = await deleteDepartment(departmentId, choice === "move" && botNames.length ? target : null);
      if (!res.ok) {
        toast.error("删除楼层失败", { description: res.error });
        return setError(res.error);
      }
      toast.success(`${name} 已删除`);
      onDone();
    });

  return (
    <TeamDialog open onOpenChange={(o) => !o && openEditor(null)} kicker="删除楼层" title={`确定删除 ${name}？`}>
      <DialogBody className="flex flex-col gap-4 px-6 py-5 text-[14px]">
        {botNames.length === 0 ? (
          <p>这个楼层没有 Bot。删除后，上面的楼层会自动下移一层。</p>
        ) : (
          <>
            <p>
              这里有 {botNames.length} 个 Bot：<b>{botNames.join("、")}</b>。你希望如何处理它们？
            </p>
            <div role="radiogroup" aria-label="如何处理这些 Bot" className="flex flex-col gap-2">
              <label className="flex cursor-pointer items-start gap-2.5 rounded-[12px] border-2 border-ink/30 p-3 has-checked:border-ink has-checked:bg-honey">
                <input type="radio" name="bots" checked={choice === "move"} onChange={() => setChoice("move")} className="mt-1 accent-ink" />
                <span className="flex-1">
                  <b>移动到其他楼层</b>
                  <span className="mt-2 block">
                    <FnSelect value={target} onChange={setTarget} items={targets} disabled={choice !== "move"} />
                  </span>
                  <span className="mt-1 block text-[12.5px] text-ink-muted">如果目标楼层已有主管，这里的主管会转为执行角色。</span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-2.5 rounded-[12px] border-2 border-ink/30 p-3 has-checked:border-[#b5473f] has-checked:bg-danger-bg">
                <input type="radio" name="bots" checked={choice === "delete"} onChange={() => setChoice("delete")} className="mt-1 accent-[#b5473f]" />
                <span>
                  <b>一起删除</b>
                  <span className="block text-[12.5px] text-ink-muted">它们的笔记和聊天记录也会删除，且无法恢复。</span>
                </span>
              </label>
            </div>
          </>
        )}
        {error && (
          <p role="alert" className="rounded-[10px] border-2 border-[#b5473f]/60 bg-danger-bg px-3 py-2 text-[13px]">
            {error}
          </p>
        )}
      </DialogBody>
      <FormFooter>
        <button type="button" className="fn-sticker h-10" onClick={onBack}>
          返回
        </button>
        <button type="button" disabled={pending} onClick={confirm} className="fn-sticker ml-auto h-10 bg-[#dd6d62] text-white">
          {pending && <Loader2 className="size-4 animate-spin" />}
          {choice === "move" && botNames.length ? "移动 Bot 并删除楼层" : "删除楼层"}
        </button>
      </FormFooter>
    </TeamDialog>
  );
}
