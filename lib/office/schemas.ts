import { z } from "zod";
import { toolsForRole, TOOL_KEYS } from "./tools";

// Shared by the dialogs (instant field errors) and the server actions (the real check).

export const AVATAR_SHAPES = ["sphere", "cube", "capsule", "cylinder", "cone", "diamond"] as const;
export const BOT_MODELS = [
  { value: "claude-sonnet-5-5", label: "Sonnet 5.5 — balanced (default)" },
  { value: "claude-haiku-5-5", label: "Haiku 5.5 — fast & cheap" },
  { value: "claude-opus-5-5", label: "Opus 5.5 — most capable" },
] as const;
export const FLOOR_STYLES = [
  { value: "custom", label: "Lounge — couch & plants" },
  { value: "assistant", label: "Assistant — desks & a couch" },
  { value: "research", label: "Research — bookshelf" },
  { value: "engineering", label: "Engineering — server racks" },
] as const;

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Pick a colour");

export const departmentSchema = z.object({
  name: z.string().trim().min(1, "Give the floor a name").max(40, "Keep it under 40 characters"),
  color: hex,
  description: z.string().trim().max(280, "Keep it under 280 characters"),
  kind: z.enum(["custom", "assistant", "research", "engineering"]),
});
export type DepartmentInput = z.infer<typeof departmentSchema>;

export const botSchema = z
  .object({
    name: z.string().trim().min(1, "Give the bot a name").max(60, "Keep it under 60 characters"),
    departmentId: z.string().uuid("Pick a floor"),
    role: z.enum(["head", "lead", "worker"]),
    shape: z.enum(AVATAR_SHAPES),
    color: hex,
    instructions: z.string().trim().max(4000, "Keep instructions under 4,000 characters"),
    tools: z.array(z.string()).max(40),
    /** Composio toolkit slugs, or ["*"] for every connected app (now and later). */
    apps: z.array(z.string().regex(/^(\*|[a-z0-9_-]{1,64})$/, "Unknown app")).max(50),
    model: z.enum(BOT_MODELS.map((m) => m.value) as [string, ...string[]]),
  })
  .superRefine((v, ctx) => {
    const allowed = new Set(toolsForRole(v.role).map((t) => t.key));
    const bad = v.tools.filter((t) => !TOOL_KEYS.has(t) || !allowed.has(t));
    if (bad.length) ctx.addIssue({ code: "custom", path: ["tools"], message: `Not available for this role: ${bad.join(", ")}` });
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
