"use client";

import { useState, useTransition } from "react";
import { ArrowRight, Check, ChevronDown, ExternalLink, GitPullRequest, KeyRound, Loader2, MessageCircleQuestion, Pencil, Plug, ShieldCheck, X } from "lucide-react";
import { toast } from "sonner";
import {
  answerQuestion,
  declineAppAccess,
  decideApproval,
  grantAppAccess,
  handOffForApp,
  skipQuestion,
} from "@/app/(routes)/workspace/inbox-actions";
import { connectToolkit } from "@/app/(routes)/workspace/connector-actions";
import { editableKeys, formatArg, isEditableAction, type PreviewCall, type PrPreview } from "@/lib/approvals/describe";
import { cn } from "@/lib/utils";
import type { Bot, InboxItem } from "@/lib/office/types";
import { BotAvatar } from "@/components/office/bot-avatar";
import { useOffice } from "@/components/office/office-provider";
import { Textarea } from "@/components/ui/textarea";

const ACTION_VERB: Record<NonNullable<InboxItem["action"]>, string> = {
  send: "发送",
  pay: "支付",
  publish: "发布",
  delete: "删除",
  merge: "合并",
  create_bot: "添加 Bot",
  create_department: "添加楼层",
  create_routine: "创建例行任务",
};

/**
 * One "Waiting on me" item. Approvals show exactly what will run (app, action, arguments) with
 * Approve / Edit / Reject; questions open the bot's chat — or, `inline`, take the answer right here.
 */
export function InboxCard({ item, bot, inline = false }: { item: InboxItem; bot: Bot; inline?: boolean }) {
  const [gone, setGone] = useState(false);
  if (gone) return null;
  if (item.kind === "access") return <AccessCard item={item} bot={bot} onDone={() => setGone(true)} />;
  return item.kind === "approval" ? (
    <ApprovalCard item={item} bot={bot} onDone={() => setGone(true)} />
  ) : (
    <QuestionCard item={item} bot={bot} inline={inline} onDone={() => setGone(true)} />
  );
}

function Shell({ bot, label, title, children }: { bot: Bot; label: string; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-[12px] border-[1.5px] border-ink/70 bg-honey p-3">
      <div className="flex gap-2.5">
        <BotAvatar bot={bot} size={30} className="shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 font-mono text-[11.5px] text-ink/70">{label}</p>
          <p className="mt-0.5 text-[14px] leading-tight font-bold break-words text-ink">{title}</p>
        </div>
      </div>
      {children}
    </div>
  );
}

function useDecision(onDone: () => void) {
  const { refreshOffice } = useOffice();
  const [pending, startTransition] = useTransition();
  const run = (action: () => Promise<{ ok: true } | { ok: false; error: string }>, success: string) =>
    startTransition(async () => {
      const res = await action();
      if (!res.ok) return void toast.error("操作失败", { description: res.error });
      toast.success(success);
      onDone();
      void refreshOffice();
    });
  return { pending, run };
}

function ApprovalCard({ item, bot, onDone }: { item: InboxItem; bot: Bot; onDone: () => void }) {
  const { canEdit, decideInbox } = useOffice();
  const { pending, run } = useDecision(onDone);
  const calls = item.calls ?? [];
  const [editing, setEditing] = useState(false);
  const [edits, setEdits] = useState<Array<Record<string, string>>>(() => calls.map(() => ({})));
  const canEditArgs = isEditableAction(item.action) && calls.some((c) => editableKeys(c.args).length > 0);
  const verb = item.action ? ACTION_VERB[item.action] : "执行操作";

  const approve = () => {
    if (!canEdit) return decideInbox(item, "approve");
    const changed = edits.some((e) => Object.keys(e).length > 0);
    run(
      () => decideApproval(item.id, "approve", changed ? { edits } : {}),
      item.action === "create_routine" ? "例行任务已创建，可在“例行任务”中查看" : item.action === "merge" ? `${bot.name} 将合并这个 PR` : `${bot.name} 将继续执行`,
    );
  };
  const reject = () => {
    if (!canEdit) return decideInbox(item, "skip");
    run(() => decideApproval(item.id, "reject"), `${bot.name} 已取消该操作`);
  };

  return (
    <Shell
      bot={bot}
      label={`${bot.name} 想要${verb}${item.ago ? ` · ${item.ago}前` : ""}`}
      title={item.title}
    >
      {item.preview && <p className="mt-1.5 text-[12.5px] leading-snug text-ink/75">{item.preview}</p>}
      {item.pr ? (
        <PullRequestPreview pr={item.pr} />
      ) : calls.length > 0 && (
        <ul className="mt-2 flex flex-col gap-2">
          {calls.map((call, i) => (
            <CallPreview
              key={i}
              call={call}
              editing={editing}
              edits={edits[i] ?? {}}
              onEdit={(key, value) => setEdits((all) => all.map((e, j) => (j === i ? { ...e, [key]: value } : e)))}
            />
          ))}
        </ul>
      )}
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        <button type="button" disabled={pending} onClick={approve} className="fn-pill border-ink bg-ink text-panel hover:bg-ink/85">
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
          {editing ? "批准修改后的内容" : "批准"}
        </button>
        {canEditArgs && (
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              if (editing) setEdits(calls.map(() => ({})));
              setEditing((e) => !e);
            }}
            className="fn-pill"
          >
            <Pencil className="size-3.5" /> {editing ? "撤销修改" : "编辑"}
          </button>
        )}
        <button type="button" disabled={pending} onClick={reject} className="fn-pill text-[#b5473f]">
          <X className="size-3.5" /> 拒绝
        </button>
      </div>
    </Shell>
  );
}

/** A merge approval: the pull request, its size, CI checks and whether GitHub can merge it. */
function PullRequestPreview({ pr }: { pr: PrPreview }) {
  const { passed, failed, pending } = pr.checks;
  const total = passed + failed + pending;
  const method = pr.method === "squash" ? "压缩合并" : pr.method === "rebase" ? "变基合并" : "普通合并";
  return (
    <div className="mt-2 rounded-[10px] border border-ink/25 bg-panel/80 p-2 text-[12px]">
      <a href={pr.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 font-bold text-ink hover:underline">
        <GitPullRequest className="size-3.5 shrink-0 text-ink/60" />
        <span className="truncate">
          {pr.repo}#{pr.number} · {pr.title}
        </span>
        <ExternalLink className="size-3 shrink-0 text-ink/50" />
      </a>
      <p className="mt-1 font-mono text-[11.5px] text-ink/75">
        {pr.branch} → {pr.base} · {method}
      </p>
      <div className="mt-1.5 flex flex-wrap gap-1 font-mono text-[11px]">
        <span className="rounded-full border border-ink/25 px-2 py-0.5">
          {pr.files} 个文件 · <span className="text-[#2e8b3e]">+{pr.additions}</span> <span className="text-[#b5473f]">−{pr.deletions}</span>
        </span>
        <span className={cn("rounded-full border px-2 py-0.5", failed ? "border-[#b5473f]/50 text-[#b5473f]" : pending ? "border-ink/25 text-ink/75" : "border-[#2e8b3e]/50 text-[#2e8b3e]")}>
          {total === 0 ? "没有 CI 检查" : failed ? `${failed} 个检查失败` : pending ? `${pending} 个检查运行中` : `${passed} 个检查通过`}
        </span>
        <span className={cn("rounded-full border px-2 py-0.5", pr.mergeable === false ? "border-[#b5473f]/50 text-[#b5473f]" : "border-ink/25 text-ink/75")}>
          {pr.mergeable === false ? `无法合并（${pr.mergeState}）` : pr.mergeable === null ? "合并状态未知" : "可以合并"}
        </span>
        {pr.draft && <span className="rounded-full border border-ink/25 px-2 py-0.5 text-ink/75">草稿 · 合并时会标记为可合并</span>}
      </div>
      <p className="mt-1.5 text-[11.5px] leading-snug text-ink/65">只会合并提交 {pr.headSha.slice(0, 7)}；如果分支之后发生变化，就不会合并。</p>
    </div>
  );
}

/** "Gmail · send email" plus its arguments; in edit mode, text arguments become editable. */
function CallPreview({
  call,
  editing,
  edits,
  onEdit,
}: {
  call: PreviewCall;
  editing: boolean;
  edits: Record<string, string>;
  onEdit: (key: string, value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const entries = Object.entries(call.args);
  const editable = new Set(editableKeys(call.args));
  return (
    <li className="rounded-[10px] border border-ink/25 bg-panel/80 p-2">
      <p className="flex items-center gap-1.5 text-[12px] font-bold text-ink">
        <ShieldCheck className="size-3.5 text-ink/60" />
        {call.app} · {call.label}
      </p>
      {entries.length > 0 && (
        <dl className={cn("mt-1.5 grid gap-1 text-[12px]", !open && !editing && "max-h-36 overflow-hidden")}>
          {entries.map(([key, value]) => (
            <div key={key} className="min-w-0">
              <dt className="font-mono text-[10.5px] tracking-wide text-ink-muted uppercase">{key.replaceAll("_", " ")}</dt>
              {editing && editable.has(key) ? (
                <Textarea
                  value={edits[key] ?? String(value)}
                  onChange={(e) => onEdit(key, e.target.value)}
                  rows={String(value).length > 80 ? 4 : 1}
                  aria-label={`编辑 ${key}`}
                  className="mt-0.5 min-h-8 resize-y rounded-[8px] border-ink/40 bg-field text-[12.5px]"
                />
              ) : (
                <dd className="break-words whitespace-pre-wrap text-ink/85">{formatArg(value)}</dd>
              )}
            </div>
          ))}
        </dl>
      )}
      {!editing && entries.length > 2 && (
        <button type="button" onClick={() => setOpen((o) => !o)} className="mt-1 flex items-center gap-1 font-mono text-[11px] text-ink-muted hover:text-ink">
          <ChevronDown className={cn("size-3 transition-transform", open && "rotate-180")} /> {open ? "收起" : "展开全部"}
        </button>
      )}
    </li>
  );
}

/**
 * "<bot> needs <app>": give it access, hand the work to a bot that already has the app, or — if
 * the app isn't connected — connect it first. Only these buttons change access; the bot just asks.
 */
function AccessCard({ item, bot, onDone }: { item: InboxItem; bot: Bot; onDone: () => void }) {
  const { canEdit, decideInbox, openSettings, snapshot } = useOffice();
  const { pending, run } = useDecision(onDone);
  const [connecting, setConnecting] = useState(false);
  const access = item.access;
  if (!access) return null;
  const app = access.appName;

  const give = () => {
    if (!canEdit) return decideInbox(item, "approve");
    run(() => grantAppAccess(item.id), `${bot.name} 现在可以使用 ${app}`);
  };
  const handTo = (holder: { id: string; name: string }) => {
    if (!canEdit) return decideInbox(item, "skip");
    run(() => handOffForApp(item.id, holder.id), `已交给 ${holder.name}`);
  };
  const decline = () => {
    if (!canEdit) return decideInbox(item, "skip");
    run(() => declineAppAccess(item.id), `${bot.name} 将在没有 ${app} 的情况下继续`);
  };
  const connect = async () => {
    if (!canEdit) return;
    setConnecting(true);
    const res = await connectToolkit(snapshot.workspace.id, access.app);
    if (res.ok) return window.location.assign(res.redirectUrl); // comes back here; then "Give access"
    setConnecting(false);
    toast.error(`连接 ${app} 失败`, { description: res.error });
    openSettings("connectors");
  };

  return (
    <Shell bot={bot} label={`${bot.name} 需要 ${app}${item.ago ? ` · ${item.ago}前` : ""}`} title={access.why || item.title}>
      <p className="mt-1.5 flex items-center gap-1.5 text-[12.5px] leading-snug text-ink/75">
        <KeyRound className="size-3.5 shrink-0" />
        {access.connected ? `${bot.name} 还没有 ${app} 的访问权限。` : `${app} 尚未连接。`}
      </p>
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {access.connected ? (
          <>
            <button type="button" disabled={pending} onClick={give} className="fn-pill border-ink bg-ink text-panel hover:bg-ink/85">
              {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} 授予权限
            </button>
            {access.holders.slice(0, 3).map((h) => (
              <button key={h.id} type="button" disabled={pending} onClick={() => handTo(h)} className="fn-pill">
                <ArrowRight className="size-3.5" /> 交给 {h.name}
              </button>
            ))}
          </>
        ) : (
          <>
            <button type="button" disabled={pending || connecting} onClick={connect} className="fn-pill border-ink bg-ink text-panel hover:bg-ink/85">
              {connecting ? <Loader2 className="size-3.5 animate-spin" /> : <Plug className="size-3.5" />} 连接 {app}
            </button>
            <button type="button" disabled={pending} onClick={give} className="fn-pill" title={`连接 ${app} 后使用`}>
              <Check className="size-3.5" /> 已连接，授予权限
            </button>
          </>
        )}
        <button type="button" disabled={pending} onClick={decline} className="fn-pill text-[#b5473f]">
          <X className="size-3.5" /> 暂不
        </button>
      </div>
    </Shell>
  );
}

function QuestionCard({ item, bot, inline, onDone }: { item: InboxItem; bot: Bot; inline: boolean; onDone: () => void }) {
  const { canEdit, decideInbox, selectBot } = useOffice();
  const { pending, run } = useDecision(onDone);
  const [answer, setAnswer] = useState("");
  const skip = () => {
    if (!canEdit) return decideInbox(item, "skip");
    run(() => skipQuestion(item.id), `${bot.name} 将在没有答复的情况下继续`);
  };

  return (
    <Shell
      bot={bot}
      label={`${bot.name} 向你提问${item.ago ? ` · ${item.ago}前` : ""}`}
      title={item.title}
    >
      {item.preview && <p className="mt-1.5 text-[12.5px] leading-snug text-ink/75">{item.preview}</p>}
      {inline ? (
        <form
          className="mt-2 flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (answer.trim()) run(() => answerQuestion(item.id, answer), `答复已发送给 ${bot.name}`);
          }}
        >
          <Textarea
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            rows={2}
            maxLength={4000}
            placeholder="输入你的答复…"
            aria-label={`回答 ${bot.name} 的问题`}
            className="min-h-12 resize-none rounded-[10px] border-2 border-ink/50 bg-field text-[13.5px]"
          />
          <div className="flex shrink-0 flex-col gap-1.5">
            <button type="submit" disabled={pending || !answer.trim()} className="fn-pill border-ink bg-ink text-panel">
              {pending ? <Loader2 className="size-3.5 animate-spin" /> : "回答"}
            </button>
            <button type="button" disabled={pending} onClick={skip} className="fn-pill">
              跳过
            </button>
          </div>
        </form>
      ) : (
        <div className="mt-2.5 flex gap-1.5">
          <button type="button" onClick={() => selectBot(bot.id, "chat")} className="fn-pill border-ink bg-ink text-panel hover:bg-ink/85">
            <MessageCircleQuestion className="size-3.5" /> 回答
          </button>
          <button type="button" disabled={pending} onClick={skip} className="fn-pill">
            跳过
          </button>
        </div>
      )}
    </Shell>
  );
}
