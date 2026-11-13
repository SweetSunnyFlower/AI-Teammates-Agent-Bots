import { Actions, Button, Card, CardText, LinkButton, type CardElement } from "chat";
import { formatArg, isEditableAction, prSummary, sourcesLine, type PreviewCall, type PrPreview } from "@/lib/approvals/describe";
import type { AccessPreview } from "@/lib/integrations/app-access";
import { appUrl } from "./env";

/**
 * "Waiting on me" items as chat cards with buttons. Button ids are short and the value is the
 * inbox item id, so they fit Telegram's 64-byte callback limit. The decision itself always runs
 * through lib/inbox/decide.ts (same as the web).
 */
export const ACTION = {
  approve: "ap",
  reject: "rj",
  answer: "an",
  skip: "sk",
  give: "ga",
  decline: "no",
  /** Hand to holder #n (`h0`…`h2`). */
  handTo: (n: number) => `h${n}`,
} as const;

export interface CardItem {
  id: string;
  workspace_id: string;
  kind: "approval" | "question" | "access";
  action: string | null;
  title: string;
  preview: Record<string, unknown> | null;
}

const VERB: Record<string, string> = {
  send: "send",
  pay: "pay",
  publish: "publish",
  delete: "delete",
  merge: "merge",
  create_bot: "add a bot",
  create_department: "add a floor",
  create_routine: "set up a routine",
};

/** Telegram only accepts https link buttons. */
function webButton(workspaceId: string, label: string) {
  const base = appUrl();
  if (!base?.startsWith("https://")) return [];
  return [LinkButton({ label, url: `${base}/workspace/${workspaceId}` })];
}

function callsText(calls: PreviewCall[]) {
  const lines: string[] = [];
  for (const call of calls.slice(0, 3)) {
    lines.push(`${call.app} · ${call.label}`);
    for (const [key, value] of Object.entries(call.args ?? {}).slice(0, 6)) {
      const text = formatArg(value).replace(/\s+/g, " ").trim();
      lines.push(`  ${key.replaceAll("_", " ")}: ${text.length > 240 ? `${text.slice(0, 240)}…` : text}`);
    }
  }
  return lines.join("\n").slice(0, 1500);
}

export function inboxCard(item: CardItem, botName: string): CardElement {
  const preview = item.preview ?? {};
  if (item.kind === "question") {
    const context = typeof preview.text === "string" ? preview.text : "";
    return Card({
      title: `❓ ${botName} asks`,
      children: [
        CardText(item.title, { style: "bold" }),
        ...(context ? [CardText(context.slice(0, 1000))] : []),
        CardText("Tap Answer, then send your reply as a message.", { style: "muted" }),
        Actions([
          Button({ id: ACTION.answer, label: "Answer", style: "primary", value: item.id }),
          Button({ id: ACTION.skip, label: "Skip", value: item.id }),
        ]),
      ],
    });
  }

  if (item.kind === "access") {
    const access = preview as unknown as AccessPreview;
    const holders = (access.holders ?? []).slice(0, 3);
    return Card({
      title: `🔑 ${botName} needs ${access.appName}`,
      children: [
        CardText(access.why || item.title, { style: "bold" }),
        CardText(access.connected ? `${botName} doesn't have ${access.appName}.` : `${access.appName} isn't connected yet — connect it in the web app first.`, { style: "muted" }),
        Actions(
          access.connected
            ? [
                Button({ id: ACTION.give, label: "Give access", style: "primary", value: item.id }),
                ...holders.map((h, i) => Button({ id: ACTION.handTo(i), label: `Hand it to ${h.name}`, value: item.id })),
                Button({ id: ACTION.decline, label: "No", style: "danger", value: item.id }),
              ]
            : [
                ...webButton(item.workspace_id, `Connect ${access.appName}`),
                Button({ id: ACTION.give, label: "Connected — give access", value: item.id }),
                Button({ id: ACTION.decline, label: "No", style: "danger", value: item.id }),
              ],
        ),
      ],
    });
  }

  const verb = item.action ? (VERB[item.action] ?? "act") : "act";
  const calls = Array.isArray(preview.calls) ? (preview.calls as PreviewCall[]) : [];
  const note = typeof preview.text === "string" ? preview.text : "";
  const pr = item.action === "merge" ? (preview.pr as PrPreview | undefined) : undefined;
  const warn = sourcesLine(Array.isArray(preview.sources) ? (preview.sources as unknown[]).map(String) : undefined);
  return Card({
    title: `✋ ${botName} wants to ${verb}`,
    children: [
      CardText(item.title, { style: "bold" }),
      ...(note ? [CardText(note.slice(0, 500))] : []),
      ...(warn ? [CardText(`⚠ ${warn}`)] : []),
      ...(pr ? [CardText(prSummary(pr))] : calls.length ? [CardText(callsText(calls))] : []),
      Actions([
        Button({ id: ACTION.approve, label: pr ? "Merge" : "Approve", style: "primary", value: item.id }),
        Button({ id: ACTION.reject, label: "Reject", style: "danger", value: item.id }),
        ...(pr ? [LinkButton({ label: "View on GitHub", url: pr.url })] : isEditableAction(item.action) ? webButton(item.workspace_id, "Edit on web") : []),
      ]),
    ],
  });
}
