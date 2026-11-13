import { hasSupabaseEnv } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import { getOfficeSnapshot as getMockSnapshot } from "./mock-data";
import type { PreviewCall, PrPreview } from "@/lib/approvals/describe";
import type { AccessPreview } from "@/lib/integrations/app-access";
import { TOOL_KEYS } from "./tools";
import { describeCron } from "@/lib/routines/schedule";
import type {
  ActivityEntry,
  AvatarShape,
  Bot,
  BotRole,
  BotStatus,
  Department,
  DepartmentKind,
  FinishedItem,
  InboxItem,
  OfficeSnapshot,
  Routine,
  Task,
  TaskCode,
  TaskStatus,
  Workspace,
} from "./types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHAPES: AvatarShape[] = ["sphere", "cube", "capsule", "cylinder", "cone", "diamond"];

export const LAST_WORKSPACE_COOKIE = "dotty_last_ws";

export function isWorkspaceId(id: string) {
  return UUID_RE.test(id);
}

/** Signed-in user's id + a short handle, or null. Uses getClaims() (verified JWT). */
export async function getCurrentUser() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) return null;
  const email = typeof claims.email === "string" ? claims.email : "";
  return { id: claims.sub, email, handle: email ? `@${email.split("@")[0]}` : "@you" };
}

/** All workspaces the signed-in user owns, oldest first. RLS limits rows to the owner. */
export async function listMyWorkspaces(handle = "@you"): Promise<Workspace[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("workspaces").select("id, name, icon").order("created_at", { ascending: true });
  if (error) throw new Error(`Could not load workspaces: ${error.message}`);
  return (data ?? []).map((w) => ({ id: w.id, name: w.name, icon: w.icon, ownerHandle: handle }));
}

/** Everything the office screen needs for one workspace; null if it doesn't exist or isn't yours. */
export async function loadOffice(workspaceId: string): Promise<OfficeSnapshot | null> {
  if (!hasSupabaseEnv) return getMockSnapshot(workspaceId);
  if (!isWorkspaceId(workspaceId)) return null;

  const user = await getCurrentUser();
  if (!user) return null;

  const supabase = await createClient();
  const [workspaces, departments, bots, inbox, tasks, routines, activity, profile, codeRuns] = await Promise.all([
    listMyWorkspaces(user.handle),
    supabase.from("departments").select("id, name, kind, floor_index, color, description").eq("workspace_id", workspaceId),
    supabase
      .from("bots")
      .select("id, department_id, role, name, instructions, tool_keys, app_keys, avatar, model, status, status_detail, last_active_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: true }),
    supabase
      .from("inbox_items")
      .select("id, bot_id, task_id, kind, action, title, preview, created_at")
      .eq("workspace_id", workspaceId)
      .eq("status", "pending")
      .order("created_at", { ascending: false }),
    supabase
      .from("tasks")
      .select("id, title, status, assignee_bot_id, created_by_bot_id, source, updated_at, result, routine_id")
      .eq("workspace_id", workspaceId)
      .in("status", ["backlog", "doing", "waiting_on_me", "done", "failed"])
      .order("position", { ascending: true })
      .order("updated_at", { ascending: false })
      .limit(200),
    supabase
      .from("routines")
      .select("id, bot_id, name, cron, timezone, prompt, enabled, next_run_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: true }),
    supabase
      .from("activity")
      .select("id, bot_id, task_id, type, summary, created_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(40),
    supabase.from("profiles").select("timezone").eq("user_id", user.id).maybeSingle(),
    supabase
      .from("code_runs")
      .select("task_id, repo, status, pr_number, pr_url, tests, pr_state")
      .eq("workspace_id", workspaceId)
      .not("task_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(200),
  ]);
  // Latest code run per task (missing table before the migration → just no badges).
  const codeByTask = new Map<string, TaskCode>();
  for (const c of codeRuns.data ?? []) {
    if (!c.task_id || codeByTask.has(c.task_id)) continue;
    codeByTask.set(c.task_id, {
      repo: c.repo,
      status: c.status as TaskCode["status"],
      prNumber: c.pr_number ?? undefined,
      prUrl: c.pr_url ?? undefined,
      tests: (c.tests ?? undefined) as TaskCode["tests"],
      prState: (c.pr_state ?? undefined) as TaskCode["prState"],
    });
  }

  const workspace = workspaces.find((w) => w.id === workspaceId);
  if (!workspace) return null;
  for (const r of [departments, bots, inbox, tasks, routines, activity]) {
    if (r.error) throw new Error(`Could not load the office: ${r.error.message}`);
  }

  const now = Date.now();
  const timeZone = profile.data?.timezone ?? "UTC";
  const clock = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone });

  const mappedTasks: Task[] = (tasks.data ?? []).flatMap((t) =>
    t.assignee_bot_id
      ? [
          {
            id: t.id,
            title: t.title,
            status: t.status as TaskStatus,
            assigneeBotId: t.assignee_bot_id,
            source: t.source as Task["source"],
            delegatedByBotId: t.created_by_bot_id ?? undefined,
            updated: ago(t.updated_at, now),
            result: resultText(t.result),
            routineId: t.routine_id ?? undefined,
            code: codeByTask.get(t.id),
          },
        ]
      : [],
  );

  return {
    workspace,
    workspaces,
    departments: (departments.data ?? []).map(
      (d): Department => ({
        id: d.id,
        name: d.name,
        kind: d.kind as DepartmentKind,
        floorIndex: d.floor_index,
        color: d.color,
        description: d.description ?? "",
      }),
    ),
    bots: (bots.data ?? []).map(
      (b): Bot => ({
        id: b.id,
        departmentId: b.department_id,
        role: b.role as BotRole,
        name: b.name,
        status: b.status as BotStatus,
        statusDetail: b.status_detail,
        lastActive: b.last_active_at ? ago(b.last_active_at, now) : "—",
        avatar: toAvatar(b.avatar),
        // Older bots may still list retired built-in app tools (gmail.search…); apps are per bot now.
        tools: ((b.tool_keys ?? []) as string[]).filter((k) => TOOL_KEYS.has(k)),
        apps: b.app_keys ?? [],
        instructions: b.instructions,
        model: b.model,
      }),
    ),
    inbox: (inbox.data ?? []).flatMap((i): InboxItem[] =>
      i.bot_id
        ? [
            {
              id: i.id,
              botId: i.bot_id,
              kind: i.kind as InboxItem["kind"],
              action: (i.action ?? undefined) as InboxItem["action"],
              title: i.title,
              preview: typeof i.preview?.text === "string" ? i.preview.text : "",
              taskId: i.task_id ?? undefined,
              calls: Array.isArray(i.preview?.calls) ? (i.preview.calls as PreviewCall[]) : undefined,
              access: i.kind === "access" ? (i.preview as AccessPreview) : undefined,
              pr: i.action === "merge" && i.preview?.pr ? (i.preview.pr as PrPreview) : undefined,
              sources: i.kind === "approval" && Array.isArray(i.preview?.sources) ? (i.preview.sources as unknown[]).map(String).slice(0, 8) : undefined,
              ago: ago(i.created_at, now),
            },
          ]
        : [],
    ),
    finished: mappedTasks
      .filter((t) => t.status === "done")
      .slice(0, 6)
      .map((t): FinishedItem => ({ id: t.id, botId: t.assigneeBotId, summary: t.title, ago: `${t.updated} ago` })),
    routines: (routines.data ?? []).map(
      (r): Routine => ({
        id: r.id,
        botId: r.bot_id,
        name: r.name,
        schedule: describeCron(r.cron),
        nextRunIn: r.enabled && r.next_run_at ? `in ${until(r.next_run_at, now)}` : "paused",
        enabled: r.enabled,
        cron: r.cron,
        timezone: r.timezone,
        prompt: r.prompt,
        // The most recently updated task this routine created.
        lastRun: (() => {
          const runs = (tasks.data ?? []).filter((t) => t.routine_id === r.id);
          const last = runs.sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
          return last ? { taskId: last.id, status: last.status as TaskStatus, ago: ago(last.updated_at, now) } : undefined;
        })(),
      }),
    ),
    activity: (activity.data ?? []).flatMap((a): ActivityEntry[] =>
      a.bot_id
        ? [{ id: a.id, botId: a.bot_id, time: clock.format(new Date(a.created_at)), text: a.summary, type: a.type, taskId: a.task_id ?? undefined }]
        : [],
    ),
    tasks: mappedTasks,
    timeZone,
  };
}

function resultText(raw: unknown) {
  const r = (raw ?? {}) as { summary?: unknown; error?: unknown };
  const text = typeof r.error === "string" ? r.error : typeof r.summary === "string" ? r.summary : undefined;
  return text?.replace(/\*\*/g, "").slice(0, 280);
}

function toAvatar(raw: unknown): Bot["avatar"] {
  const a = (raw ?? {}) as { shape?: string; color?: string };
  const shape = SHAPES.includes(a.shape as AvatarShape) ? (a.shape as AvatarShape) : "sphere";
  const color = typeof a.color === "string" && /^#[0-9a-f]{6}$/i.test(a.color) ? a.color : "#5c8fd6";
  return { shape, color };
}

function ago(iso: string, now: number) {
  const mins = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  return hours < 24 ? `${hours}h` : `${Math.round(hours / 24)}d`;
}

function until(iso: string, now: number) {
  const mins = Math.max(0, Math.round((new Date(iso).getTime() - now) / 60000));
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  return `${h} h ${mins % 60} min`;
}
