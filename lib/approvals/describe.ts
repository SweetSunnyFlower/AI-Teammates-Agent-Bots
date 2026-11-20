/**
 * Turning gated app calls into something a person can approve. Pure — used by the run (to write
 * the inbox item), the server action (to apply edits) and the UI.
 */

export type InboxAction = "send" | "pay" | "publish" | "delete" | "merge" | "create_bot" | "create_department" | "create_routine";

export interface PreviewCall {
  tool: string;
  /** "Gmail", "Notion"… */
  app: string;
  /** "send email" */
  label: string;
  args: Record<string, unknown>;
}

/** The stored `inbox_items.preview` of an approval. */
export interface ApprovalPreview {
  text: string;
  calls: PreviewCall[];
  /** Merge approvals: the pull request as it was when the bot asked. */
  pr?: PrPreview;
}

/** What a merge approval shows: the exact pull request head that will be merged. */
export interface PrPreview {
  repo: string;
  number: number;
  title: string;
  url: string;
  branch: string;
  base: string;
  draft: boolean;
  files: number;
  additions: number;
  deletions: number;
  checks: { passed: number; failed: number; pending: number };
  /** GitHub's mergeability (null while it's still computing). */
  mergeable: boolean | null;
  mergeState: string;
  /** The head commit the user approves — the merge is refused if the branch moved since. */
  headSha: string;
  method: "merge" | "squash" | "rebase";
}

/** "acme/web#12 · 3 files (+40 −5) · checks: 4 passed, 1 failed · can merge" */
export function prSummary(pr: PrPreview) {
  const { passed, failed, pending } = pr.checks;
  const checks =
    passed + failed + pending === 0
      ? "没有 CI 检查"
      : `检查：${[passed && `${passed} 个通过`, failed && `${failed} 个失败`, pending && `${pending} 个运行中`].filter(Boolean).join("，")}`;
  const state = pr.mergeable === false ? `无法合并（${pr.mergeState}）` : pr.mergeable === null ? "合并状态未知" : "可以合并";
  return `${pr.repo}#${pr.number} · ${pr.branch} → ${pr.base} · ${pr.files} 个文件（+${pr.additions} −${pr.deletions}）· ${checks} · ${state}${pr.draft ? " · 草稿（合并时标记为可合并）" : ""}`;
}

const APP_NAMES: Record<string, string> = {
  GMAIL: "Gmail",
  GOOGLECALENDAR: "Google Calendar",
  GOOGLEDRIVE: "Google Drive",
  GOOGLEDOCS: "Google Docs",
  GOOGLESHEETS: "Google Sheets",
  GITHUB: "GitHub",
  NOTION: "Notion",
  SLACK: "Slack",
  LINEAR: "Linear",
  TWITTER: "X",
  LINKEDIN: "LinkedIn",
  OUTLOOK: "Outlook",
};

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

function actionLabel(slug: string, raw: string) {
  const value = `${slug} ${raw}`.toUpperCase();
  if (/SEND.*EMAIL|REPLY|FORWARD|MESSAGE/.test(value)) return "发送消息";
  if (/CREATE.*EVENT|ADD.*EVENT/.test(value)) return "创建日程";
  if (/LIST.*EVENT|GET.*EVENT|CALENDAR/.test(value)) return "读取日程";
  if (/CREATE|ADD|INSERT|WRITE|UPDATE|EDIT|PATCH/.test(value)) return "修改内容";
  if (/DELETE|REMOVE|TRASH|ARCHIVE/.test(value)) return "删除内容";
  if (/SEARCH|FIND|QUERY/.test(value)) return "搜索";
  if (/LIST|GET|READ|FETCH|RETRIEVE/.test(value)) return "读取";
  if (/MERGE/.test(value)) return "合并";
  return "执行操作";
}

/** "GMAIL_SEND_EMAIL" → { app: "Gmail", label: "发送消息" }. */
export function describeTool(slug: string) {
  const [head, ...rest] = slug.split("_");
  const app = APP_NAMES[head] ?? capitalize(head ?? slug);
  const raw = rest.join("_");
  const label = actionLabel(slug, raw);
  return { app, label };
}

/** Which kind of approval this is (for the "wants to …" line and the recap). */
export function actionFor(slugs: string[]): InboxAction {
  const all = slugs.join(" ").toUpperCase();
  if (/DELETE|TRASH|REMOVE|ARCHIVE|DESTROY/.test(all)) return "delete";
  if (/MERGE/.test(all)) return "merge";
  if (/SEND|REPLY|FORWARD|MESSAGE|INVITE|EMAIL/.test(all)) return "send";
  return "publish";
}

export function buildPreview(
  calls: Array<{ tool: string; args: Record<string, unknown> }>,
  reasons: string[],
  pr?: PrPreview,
): {
  title: string;
  action: InboxAction;
  preview: ApprovalPreview;
} {
  const described = calls.map((c) => ({ ...c, ...describeTool(c.tool) }));
  const first = described[0];
  const title = first
    ? `${first.app}：${first.label}${described.length > 1 ? `（另有 ${described.length - 1} 项）` : ""}`
    : "应用操作";
  return {
    title: title.slice(0, 200),
    action: actionFor(calls.map((c) => c.tool)),
    preview: { text: reasons[0]?.slice(0, 500) ?? "", calls: described, ...(pr ? { pr } : {}) },
  };
}

/** Approvals whose arguments can't be edited: a merge is exactly the pull request shown. */
export const isEditableAction = (action: string | null | undefined) => action !== "merge";

/** Argument keys that are safe and useful to edit as text (recipient, subject, body…). */
export function editableKeys(args: Record<string, unknown>) {
  return Object.entries(args)
    .filter(([, v]) => typeof v === "string")
    .map(([k]) => k);
}

/**
 * Apply the user's text edits to a stored tool input. Only existing string arguments can change —
 * never which tool runs, never new arguments — so an edit can't turn into a different action.
 * `input` is the exact gated call (`{ tools: [{ tool_slug, arguments }] }` for a batch).
 */
export function applyEdits(input: Record<string, unknown>, edits: Array<Record<string, string>>) {
  const copy = structuredClone(input);
  const list = Array.isArray(copy.tools) ? (copy.tools as Array<{ arguments?: Record<string, unknown> }>) : null;
  const targets = list ? list.map((c) => c.arguments ?? {}) : [copy];
  edits.forEach((edit, i) => {
    const target = targets[i];
    if (!target) return;
    for (const [key, value] of Object.entries(edit)) {
      if (typeof target[key] === "string" && typeof value === "string") target[key] = value.slice(0, 20000);
    }
  });
  return copy;
}

/** Short human text for an argument value. */
export function formatArg(value: unknown) {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "—";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value, null, 1);
}
