import { tool } from "ai";
import { z } from "zod";
import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export interface ChatBot {
  id: string;
  workspace_id: string;
  department_id: string;
  role: "head" | "lead" | "worker";
  name: string;
  instructions: string;
  tool_keys: string[];
  model: string;
}

interface Roster {
  floors: Array<{ id: string; name: string; floor_index: number; description: string; kind: string }>;
  bots: Array<{ id: string; name: string; role: string; department_id: string; instructions: string }>;
}

/** Loads the bot (RLS: only the owner's bots are visible) plus what it needs to know. */
export async function loadChatContext(supabase: Supabase, botId: string) {
  const { data: bot } = await supabase
    .from("bots")
    .select("id, workspace_id, department_id, role, name, instructions, tool_keys, model")
    .eq("id", botId)
    .maybeSingle<ChatBot>();
  if (!bot) return null;

  const [workspace, floors, bots, notes, tasks] = await Promise.all([
    supabase.from("workspaces").select("name, daily_task_cap").eq("id", bot.workspace_id).single(),
    supabase.from("departments").select("id, name, floor_index, description, kind").eq("workspace_id", bot.workspace_id).order("floor_index", { ascending: false }),
    supabase.from("bots").select("id, name, role, department_id, instructions").eq("workspace_id", bot.workspace_id),
    supabase.from("bot_notes").select("content").eq("bot_id", bot.id).maybeSingle(),
    openTasksFor(supabase, bot),
  ]);

  const roster: Roster = { floors: floors.data ?? [], bots: bots.data ?? [] };
  return {
    bot,
    workspaceName: workspace.data?.name ?? "the workspace",
    dailyTaskCap: workspace.data?.daily_task_cap ?? 50,
    roster,
    notes: notes.data?.content ?? "",
    openTasks: tasks,
  };
}

export type ChatContext = NonNullable<Awaited<ReturnType<typeof loadChatContext>>>;

async function openTasksFor(supabase: Supabase, bot: ChatBot) {
  // The Head sees the whole board; everyone else sees their own work.
  let q = supabase
    .from("tasks")
    .select("id, title, status, assignee_bot_id, updated_at")
    .eq("workspace_id", bot.workspace_id)
    .in("status", ["backlog", "doing", "waiting_on_me"])
    .order("updated_at", { ascending: false })
    .limit(25);
  if (bot.role !== "head") q = q.eq("assignee_bot_id", bot.id);
  const { data } = await q;
  return data ?? [];
}

const canDelegate = (bot: ChatBot) => bot.role === "head" || (bot.role === "lead" && bot.tool_keys.includes("assign_task"));

/** System instructions: who the bot is, where it sits, who else works here, and the house rules. */
export function buildInstructions(ctx: ChatContext, userTimezone: string) {
  const { bot, roster } = ctx;
  const floorOf = (id: string) => roster.floors.find((f) => f.id === id);
  const myFloor = floorOf(bot.department_id);
  const nameOf = (id: string | null) => roster.bots.find((b) => b.id === id)?.name ?? "unassigned";

  const team = roster.floors
    .map((f) => {
      const members = roster.bots
        .filter((b) => b.department_id === f.id)
        .map((b) => `${b.name} (${b.role})${b.instructions ? ` — ${b.instructions.slice(0, 120)}` : ""}`)
        .join("; ");
      return `- ${f.floor_index}F ${f.name}${f.description ? ` (${f.description})` : ""}: ${members || "no bots yet"}`;
    })
    .join("\n");

  const tasks = ctx.openTasks.length
    ? ctx.openTasks.map((t) => `- [${t.status}] ${t.title} → ${nameOf(t.assignee_bot_id)}`).join("\n")
    : "- none";

  const roleLine =
    bot.role === "head"
      ? "You are the Head bot: you turn the user's requests into a plan and delegate tasks to the right bots on any floor."
      : bot.role === "lead"
        ? `You lead the ${myFloor?.name ?? ""} floor and can hand tasks to any bot in the building.`
        : `You work on the ${myFloor?.name ?? ""} floor.`;

  return [
    `You are ${bot.name}, an AI teammate in "${ctx.workspaceName}", a small office of AI bots run by one person (the user).`,
    roleLine,
    bot.instructions ? `Your job, in the user's words: ${bot.instructions}` : "",
    `Today is ${new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: userTimezone })} (${userTimezone}).`,
    "",
    "The building (top floor first):",
    team,
    "",
    bot.role === "head" ? "Open tasks across the building:" : "Your open tasks:",
    tasks,
    "",
    ctx.notes ? `Your notes (your memory between chats):\n${ctx.notes.slice(0, 4000)}` : "You have no notes yet.",
    "",
    "How to work:",
    "- Be brief and friendly, like a capable coworker in a chat. Use short paragraphs or bullets.",
    "- Answer simple questions directly. For real work (research, emails, coding, anything that takes time), create a task with create_task instead of pretending to do it in chat.",
    canDelegate(bot)
      ? "- You may assign tasks to any bot; pick the bot whose floor and job fit best. Split big requests into a few clear tasks."
      : "- You can only create tasks for yourself; suggest the user ask the Head bot for work that belongs on another floor.",
    "- Background work is being set up: tasks you create go on the board and will run soon. Say so honestly; never claim work is finished when it isn't.",
    "- Nothing that sends, pays, publishes, deletes or merges ever happens without the user's approval.",
    "- Keep your notes short and useful (preferences, facts about the user, ongoing context).",
  ]
    .filter((l) => l !== undefined)
    .join("\n");
}

/** Chat tools. They run as the signed-in user, so row-level security applies to every write. */
export function buildChatTools(supabase: Supabase, ctx: ChatContext) {
  const { bot, roster } = ctx;
  const has = (key: string) => bot.role === "head" || bot.tool_keys.includes(key);

  const tools = {
    list_tasks: tool({
      description: canDelegate(bot) ? "List open tasks across the building." : "List your open tasks.",
      inputSchema: z.object({}),
      execute: async () => ({ tasks: await openTasksFor(supabase, bot) }),
    }),

    create_task: tool({
      description: canDelegate(bot)
        ? "Create a task on the board and assign it to a bot (by exact bot name). Use for any real work."
        : "Create a task on the board for yourself. Use for any real work.",
      inputSchema: z.object({
        title: z.string().min(3).max(200).describe("Short, specific task title"),
        details: z.string().max(4000).optional().describe("What done looks like, constraints, links"),
        assignee: z.string().optional().describe("Exact name of the bot to assign (defaults to you)"),
      }),
      execute: async ({ title, details, assignee }) => {
        const target = assignee ? roster.bots.find((b) => b.name.toLowerCase() === assignee.trim().toLowerCase()) : roster.bots.find((b) => b.id === bot.id);
        if (!target) return { ok: false, error: `No bot named "${assignee}". Bots: ${roster.bots.map((b) => b.name).join(", ")}` };
        if (target.id !== bot.id && !canDelegate(bot)) return { ok: false, error: "You can only create tasks for yourself." };

        const since = new Date();
        since.setHours(0, 0, 0, 0);
        const { count } = await supabase
          .from("tasks")
          .select("id", { count: "exact", head: true })
          .eq("workspace_id", bot.workspace_id)
          .gte("created_at", since.toISOString());
        if ((count ?? 0) >= ctx.dailyTaskCap) return { ok: false, error: `The daily task cap (${ctx.dailyTaskCap}) is reached.` };

        const { data, error } = await supabase
          .from("tasks")
          .insert({
            workspace_id: bot.workspace_id,
            title: title.trim(),
            body: details?.trim() ?? "",
            status: "backlog",
            assignee_bot_id: target.id,
            created_by_bot_id: bot.id,
            source: "web",
          })
          .select("id")
          .single();
        if (error) return { ok: false, error: error.message };
        return { ok: true, taskId: data.id, title: title.trim(), assignee: target.name };
      },
    }),
  };

  return {
    ...tools,
    ...(has("notes.read")
      ? {
          read_notes: tool({
            description: "Read your notes (your memory between chats).",
            inputSchema: z.object({}),
            execute: async () => {
              const { data } = await supabase.from("bot_notes").select("content").eq("bot_id", bot.id).maybeSingle();
              return { notes: data?.content ?? "" };
            },
          }),
        }
      : {}),
    ...(has("notes.write")
      ? {
          update_notes: tool({
            description: "Replace your notes with an updated version. Keep them short; include anything still useful from before.",
            inputSchema: z.object({ content: z.string().max(20000) }),
            execute: async ({ content }) => {
              const { error } = await supabase
                .from("bot_notes")
                .upsert({ workspace_id: bot.workspace_id, bot_id: bot.id, content }, { onConflict: "bot_id" });
              return error ? { ok: false, error: error.message } : { ok: true };
            },
          }),
        }
      : {}),
  };
}
