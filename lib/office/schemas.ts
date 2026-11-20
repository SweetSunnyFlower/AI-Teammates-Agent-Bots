import { z } from "zod";
import { toolsForRole, TOOL_KEYS } from "./tools";

// Shared by the dialogs (instant field errors) and the server actions (the real check).

export const AVATAR_SHAPES = ["sphere", "cube", "capsule", "cylinder", "cone", "diamond"] as const;
export const BOT_MODELS = [
  { value: "deepseek-chat", label: "DeepSeek Chat — 快速均衡（默认）" },
  { value: "deepseek-reasoner", label: "DeepSeek Reasoner — 深度推理" },
] as const;
export const FLOOR_STYLES = [
  { value: "custom", label: "休闲区 — 沙发与绿植" },
  { value: "assistant", label: "助理 — 工位与沙发" },
  { value: "research", label: "研究 — 书架" },
  { value: "engineering", label: "工程 — 服务器机柜" },
] as const;

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "请选择颜色");

export const departmentSchema = z.object({
  name: z.string().trim().min(1, "请填写楼层名称").max(40, "楼层名称不能超过 40 个字符"),
  color: hex,
  description: z.string().trim().max(280, "楼层说明不能超过 280 个字符"),
  kind: z.enum(["custom", "assistant", "research", "engineering"]),
});
export type DepartmentInput = z.infer<typeof departmentSchema>;

export const botSchema = z
  .object({
    name: z.string().trim().min(1, "请填写 Bot 名称").max(60, "Bot 名称不能超过 60 个字符"),
    departmentId: z.string().uuid("请选择楼层"),
    role: z.enum(["head", "lead", "worker"]),
    shape: z.enum(AVATAR_SHAPES),
    color: hex,
    instructions: z.string().trim().max(4000, "职责说明不能超过 4,000 个字符"),
    tools: z.array(z.string()).max(40),
    /** Composio toolkit slugs, or ["*"] for every connected app (now and later). */
    apps: z.array(z.string().regex(/^(\*|[a-z0-9_-]{1,64})$/, "未知应用")).max(50),
    model: z.enum(BOT_MODELS.map((m) => m.value) as [string, ...string[]]),
  })
  .superRefine((v, ctx) => {
    const allowed = new Set(toolsForRole(v.role).map((t) => t.key));
    const bad = v.tools.filter((t) => !TOOL_KEYS.has(t) || !allowed.has(t));
    if (bad.length) ctx.addIssue({ code: "custom", path: ["tools"], message: `当前角色不能使用这些工具：${bad.join("、")}` });
  });
export type BotInput = z.infer<typeof botSchema>;

export const deleteDepartmentSchema = z.object({
  departmentId: z.string().uuid(),
  moveBotsTo: z.string().uuid().nullable(),
});

/** zod issues → { field: message } for the Field components. */
export function fieldErrors(error: z.ZodError) {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    out[key] ??= issue.message;
  }
  return out;
}
