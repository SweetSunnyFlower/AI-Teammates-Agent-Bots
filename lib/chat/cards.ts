import { Actions, Button, Card, CardText, LinkButton, type CardElement } from "chat";
import { formatArg, isEditableAction, prSummary, type PreviewCall, type PrPreview } from "@/lib/approvals/describe";
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
  send: "发送",
  pay: "支付",
  publish: "发布",
  delete: "删除",
  merge: "合并",
  create_bot: "添加 Bot",
  create_department: "添加楼层",
  create_routine: "创建例行任务",
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
      title: `❓ ${botName} 向你提问`,
      children: [
        CardText(item.title, { style: "bold" }),
        ...(context ? [CardText(context.slice(0, 1000))] : []),
        CardText("点击“回答”，然后在下一条消息中发送答复。", { style: "muted" }),
        Actions([
          Button({ id: ACTION.answer, label: "回答", style: "primary", value: item.id }),
          Button({ id: ACTION.skip, label: "跳过", value: item.id }),
        ]),
      ],
    });
  }

  if (item.kind === "access") {
    const access = preview as unknown as AccessPreview;
    const holders = (access.holders ?? []).slice(0, 3);
    return Card({
      title: `🔑 ${botName} 需要 ${access.appName}`,
      children: [
        CardText(access.why || item.title, { style: "bold" }),
        CardText(access.connected ? `${botName} 还没有 ${access.appName} 的访问权限。` : `${access.appName} 尚未连接，请先在网页端连接。`, { style: "muted" }),
        Actions(
          access.connected
            ? [
                Button({ id: ACTION.give, label: "授予权限", style: "primary", value: item.id }),
                ...holders.map((h, i) => Button({ id: ACTION.handTo(i), label: `交给 ${h.name}`, value: item.id })),
                Button({ id: ACTION.decline, label: "暂不", style: "danger", value: item.id }),
              ]
            : [
                ...webButton(item.workspace_id, `连接 ${access.appName}`),
                Button({ id: ACTION.give, label: "已连接，授予权限", value: item.id }),
                Button({ id: ACTION.decline, label: "暂不", style: "danger", value: item.id }),
              ],
        ),
      ],
    });
  }

  const verb = item.action ? (VERB[item.action] ?? "执行操作") : "执行操作";
  const calls = Array.isArray(preview.calls) ? (preview.calls as PreviewCall[]) : [];
  const note = typeof preview.text === "string" ? preview.text : "";
  const pr = item.action === "merge" ? (preview.pr as PrPreview | undefined) : undefined;
  return Card({
    title: `✋ ${botName} 想要${verb}`,
    children: [
      CardText(item.title, { style: "bold" }),
      ...(note ? [CardText(note.slice(0, 500))] : []),
      ...(pr ? [CardText(prSummary(pr))] : calls.length ? [CardText(callsText(calls))] : []),
      Actions([
        Button({ id: ACTION.approve, label: pr ? "合并" : "批准", style: "primary", value: item.id }),
        Button({ id: ACTION.reject, label: "拒绝", style: "danger", value: item.id }),
        ...(pr ? [LinkButton({ label: "在 GitHub 查看", url: pr.url })] : isEditableAction(item.action) ? webButton(item.workspace_id, "在网页编辑") : []),
      ]),
    ],
  });
}
