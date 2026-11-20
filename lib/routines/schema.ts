import { z } from "zod";
import { cronError, isValidTimeZone } from "./schedule";

/** Shared by the routine dialog (instant field errors) and the server actions (the real check). */
export const routineSchema = z
  .object({
    name: z.string().trim().min(1, "请填写例行任务名称").max(80, "名称不能超过 80 个字符"),
    botId: z.string().uuid("请选择 Bot"),
    cron: z.string().trim().max(100),
    timezone: z.string().trim().min(1).max(64),
    prompt: z.string().trim().min(3, "请说明 Bot 每次要做什么").max(4000, "说明不能超过 4,000 个字符"),
    enabled: z.boolean(),
  })
  .superRefine((v, ctx) => {
    const bad = cronError(v.cron);
    if (bad) ctx.addIssue({ code: "custom", path: ["cron"], message: bad });
    if (!isValidTimeZone(v.timezone)) ctx.addIssue({ code: "custom", path: ["timezone"], message: "请从列表中选择有效时区" });
  });

export type RoutineInput = z.infer<typeof routineSchema>;

/** Most routines one workspace can have. */
export const MAX_ROUTINES = 50;
