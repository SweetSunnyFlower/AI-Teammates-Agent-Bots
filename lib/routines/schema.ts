import { z } from "zod";
import { cronError, isValidTimeZone } from "./schedule";

/** Shared by the routine dialog (instant field errors) and the server actions (the real check). */
export const routineSchema = z
  .object({
    name: z.string().trim().min(1, "Give the routine a name").max(80, "Keep it under 80 characters"),
    botId: z.string().uuid("Pick a bot"),
    cron: z.string().trim().max(100),
    timezone: z.string().trim().min(1).max(64),
    prompt: z.string().trim().min(3, "Say what the bot should do").max(4000, "Keep it under 4,000 characters"),
    enabled: z.boolean(),
  })
  .superRefine((v, ctx) => {
    const bad = cronError(v.cron);
    if (bad) ctx.addIssue({ code: "custom", path: ["cron"], message: bad });
    if (!isValidTimeZone(v.timezone)) ctx.addIssue({ code: "custom", path: ["timezone"], message: "Pick a timezone from the list" });
  });

export type RoutineInput = z.infer<typeof routineSchema>;

/** Most routines one workspace can have. */
export const MAX_ROUTINES = 50;
