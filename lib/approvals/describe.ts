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

/** "GMAIL_SEND_EMAIL" → { app: "Gmail", label: "send email" }. */
export function describeTool(slug: string) {
  const [head, ...rest] = slug.split("_");
  const app = APP_NAMES[head] ?? capitalize(head ?? slug);
  const label = rest.join(" ").toLowerCase() || slug.toLowerCase();
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

export function buildPreview(calls: Array<{ tool: string; args: Record<string, unknown> }>, reasons: string[]): {
  title: string;
  action: InboxAction;
  preview: ApprovalPreview;
} {
  const described = calls.map((c) => ({ ...c, ...describeTool(c.tool) }));
  const first = described[0];
  const title = first
    ? `${first.app}: ${first.label}${described.length > 1 ? ` (+${described.length - 1} more)` : ""}`
    : "An app action";
  return {
    title: title.slice(0, 200),
    action: actionFor(calls.map((c) => c.tool)),
    preview: { text: reasons[0]?.slice(0, 500) ?? "", calls: described },
  };
}

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
