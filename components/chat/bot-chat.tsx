"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Chat, useChat } from "@ai-sdk/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DefaultChatTransport } from "ai";
import { ArrowUp, ClipboardList, NotebookPen, RotateCcw, Search, Square, SquarePen } from "lucide-react";
import { describeAppTool, isAppTool } from "@/lib/integrations/tool-labels";
import { toast } from "sonner";
import { Streamdown } from "streamdown";
import { loadThread, startNewChat, type ThreadMessage } from "@/app/(routes)/workspace/chat-actions";
import { subscribeLive } from "@/lib/supabase/realtime";
import { BotAvatar } from "@/components/office/bot-avatar";
import { InboxCard } from "@/components/inbox/inbox-card";
import { useOffice } from "@/components/office/office-provider";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "@/components/ui/input-group";
import { Message, MessageAvatar, MessageContent } from "@/components/ui/message";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { Bot } from "@/lib/office/types";
import { LoadingLabel, Skeleton } from "@/components/ui/skeleton";

/** Words the bot "says" while it works on a reply (shimmering, like Claude's). */
const THINKING_WORDS = ["Whirring", "Thinking", "Ideating", "Unraveling", "Pondering", "Tinkering", "Noodling", "Percolating", "Scheming", "Brewing"];

/** Chat instances by bot id — module-level so they survive tab switches and drawer close/open. */
const chats = new Map<string, Chat<ThreadMessage>>();
/** When each bot's Chat was last filled from the saved thread (query `dataUpdatedAt`). */
const seededAt = new Map<string, number>();

function chatFor(botId: string) {
  let chat = chats.get(botId);
  if (!chat) {
    chat = new Chat<ThreadMessage>({
      id: `bot-${botId}`,
      transport: new DefaultChatTransport<ThreadMessage>({
        api: `/api/chat/${botId}`,
        // The server keeps the thread; send only the new message.
        prepareSendMessagesRequest: ({ messages }) => ({ body: { message: messages[messages.length - 1] } }),
      }),
    });
    chats.set(botId, chat);
  }
  return chat;
}

/** One continuous thread per bot. "New chat" adds a divider; the bot only remembers what's below it. */
export function BotChat({ bot }: { bot: Bot }) {
  const { canEdit, snapshot, pendingAsk, clearPendingAsk, focusMessage, clearFocusMessage } = useOffice();
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const queryClient = useQueryClient();

  // The saved thread, cached: switching tabs or bots and coming back shows it instantly.
  const thread = useQuery({
    queryKey: ["thread", bot.id],
    queryFn: async () => {
      const res = await loadThread(bot.id);
      if (!res.ok) throw new Error(res.error);
      return res.messages;
    },
    enabled: canEdit,
    staleTime: 60_000,
    gcTime: Infinity,
  });

  // One Chat per bot, kept across mounts — a reply keeps streaming even while you're on another tab.
  const { messages, setMessages, sendMessage, status, error, stop, regenerate, clearError } = useChat<ThreadMessage>({
    chat: chatFor(bot.id),
  });
  const loaded = thread.data !== undefined || seededAt.has(bot.id);
  const loadError = !loaded && thread.error ? thread.error.message : null;

  // Show the saved thread when it (re)loads — but never swap messages out mid-reply.
  useEffect(() => {
    if (!thread.data || status === "submitted" || status === "streaming") return;
    if ((seededAt.get(bot.id) ?? -1) >= thread.dataUpdatedAt) return;
    seededAt.set(bot.id, thread.dataUpdatedAt);
    setMessages(thread.data);
  }, [thread.data, thread.dataUpdatedAt, status, bot.id, setMessages]);

  // Live thread: run reports (and messages from other tabs) appear without a reload.
  useEffect(() => {
    if (!canEdit) return;
    return subscribeLive(
      `thread:${bot.id}`,
      (channel) =>
        channel.on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `bot_id=eq.${bot.id}` }, (payload) => {
          const row = payload.new as { id: string; ui_id: string | null; role: ThreadMessage["role"]; kind: string; parts: ThreadMessage["parts"]; created_at: string };
          const id = row.ui_id ?? row.id;
          setMessages((current) =>
            current.some((m) => m.id === id)
              ? current
              : [...current, { id, role: row.role, parts: row.kind === "divider" ? [] : row.parts, metadata: { createdAt: row.created_at, divider: row.kind === "divider" || undefined } }],
          );
        }),
      // Reconnected after a drop: fetch anything we missed.
      (rejoined) => {
        if (rejoined) void queryClient.invalidateQueries({ queryKey: ["thread", bot.id] });
      },
    );
  }, [bot.id, canEdit, setMessages, queryClient]);

  // "Read reply": scroll to the task's report and highlight it for a moment.
  useEffect(() => {
    if (!loaded || !focusMessage || focusMessage.botId !== bot.id) return;
    const target = [...messages].reverse().find((m) => m.id.startsWith(focusMessage.prefix));
    if (!target) return; // not arrived yet — this runs again when messages update
    let clear: number | undefined;
    const frame = window.requestAnimationFrame(() => {
      clearFocusMessage();
      setHighlightId(target.id);
      document.getElementById(`msg-${target.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      clear = window.setTimeout(() => setHighlightId(null), 2600);
    });
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(clear);
    };
  }, [loaded, focusMessage, bot.id, messages, clearFocusMessage]);

  // "Ask the Head" hands its message over once the thread is loaded. The nonce is remembered
  // because clearPendingAsk() only takes effect on the next render: without it React would run
  // this effect again with the same pendingAsk (it always does in development) and send twice.
  const sentAskRef = useRef<number | null>(null);
  useEffect(() => {
    if (!loaded || !pendingAsk || pendingAsk.botId !== bot.id) return;
    if (sentAskRef.current === pendingAsk.nonce) return;
    sentAskRef.current = pendingAsk.nonce;
    clearPendingAsk();
    void sendMessage({ text: pendingAsk.text });
  }, [loaded, pendingAsk, bot.id, clearPendingAsk, sendMessage]);

  const busy = status === "submitted" || status === "streaming";
  const last = messages[messages.length - 1];
  // Show the thinking shimmer until the reply's first words arrive.
  const thinking = status === "submitted" || (status === "streaming" && !(last?.role === "assistant" && hasText(last)));
  const waiting = snapshot.inbox.filter((i) => i.botId === bot.id);

  const send = () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    void sendMessage({ text });
  };

  const [newChatPending, startNewChatTransition] = useTransition();
  const newChat = () =>
    startNewChatTransition(async () => {
      const res = await startNewChat(bot.id);
      if (!res.ok) return void toast.error("Couldn't start a new chat", { description: res.error });
      setMessages((m) => [...m, res.divider]);
      clearError();
    });

  if (!canEdit) {
    return (
      <p className="m-4 rounded-[12px] bg-panel-sunken p-3 text-[13px] text-ink/80">
        This is the demo office. Sign in and open your own workspace to chat with your bots.
      </p>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-start justify-between gap-3 border-b border-hairline px-4 py-2.5">
        <div className="min-w-0">
          <p className="truncate text-[14px] font-bold text-ink">Chat with {bot.name}</p>
          <p className="truncate text-[12px] text-ink-muted">{memoryNote(messages)}</p>
        </div>
        <Tooltip>
          <TooltipTrigger
            onClick={newChat}
            disabled={busy || newChatPending || !loaded || messages.length === 0 || Boolean(last?.metadata?.divider)}
            aria-label="Start a new chat"
            className="fn-sticker h-9 shrink-0 gap-1.5 px-3 text-[13px]"
          >
            {newChatPending ? <Spinner className="size-3.5" /> : <SquarePen className="size-3.5" />}
            New chat
          </TooltipTrigger>
          <TooltipContent className="max-w-56 text-center">
            Starts fresh: {bot.name} forgets the messages above. Nothing is deleted.
          </TooltipContent>
        </Tooltip>
      </div>

      <MessageScrollerProvider autoScroll>
        <MessageScroller className="min-h-0 flex-1">
          <MessageScrollerViewport>
            <MessageScrollerContent className="gap-4 px-3 py-3">
              {!loaded ? (
                <ChatSkeleton />
              ) : loadError ? (
                <p className="rounded-[10px] bg-danger-bg px-3 py-2 text-[13px]">{loadError}</p>
              ) : messages.length === 0 && !busy ? (
                <Greeting bot={bot} />
              ) : (
                messages.map((m, i) => (
                  <MessageScrollerItem
                    key={m.id}
                    id={`msg-${m.id}`}
                    messageId={m.id}
                    scrollAnchor={m.role === "user"}
                    className={cn(
                      "scroll-my-6 rounded-[14px] transition-[background-color,box-shadow] duration-700",
                      highlightId === m.id && "bg-honey/60 ring-2 ring-[#f0dab1] ring-offset-4 ring-offset-panel",
                    )}
                  >
                    {m.metadata?.divider ? (
                      <Divider at={m.metadata.createdAt} />
                    ) : (
                      <ChatMessage message={m} bot={bot} streaming={status === "streaming" && i === messages.length - 1} />
                    )}
                  </MessageScrollerItem>
                ))
              )}

              {thinking && (
                <MessageScrollerItem messageId="thinking">
                  <Thinking bot={bot} />
                </MessageScrollerItem>
              )}

              {waiting.map((item) => (
                <MessageScrollerItem key={item.id} messageId={`inbox-${item.id}`}>
                  <InboxCard item={item} bot={bot} inline />
                </MessageScrollerItem>
              ))}

              {error && (
                <MessageScrollerItem messageId="error">
                  <div role="alert" className="flex items-start gap-2 rounded-[10px] border-2 border-[#b5473f]/50 bg-danger-bg px-3 py-2 text-[13px]">
                    <span className="flex-1">{readError(error)}</span>
                    <button type="button" className="fn-pill shrink-0 px-2 py-0.5 text-[11.5px]" onClick={() => void regenerate()}>
                      <RotateCcw className="size-3" /> retry
                    </button>
                  </div>
                </MessageScrollerItem>
              )}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton className="border-2 border-ink bg-panel text-ink hover:bg-panel-sunken" />
        </MessageScroller>
      </MessageScrollerProvider>

      <form
        className="border-t border-hairline px-3 py-2"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <InputGroup className="h-auto min-h-10 rounded-full border-2 border-ink/60 bg-field pr-1 has-[[data-slot=input-group-control]:focus-visible]:border-ink">
          <InputGroupTextarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
            rows={1}
            maxLength={4000}
            placeholder={`Message ${bot.name}…`}
            aria-label={`Message ${bot.name} (Enter to send, Shift+Enter for a new line)`}
            className="field-sizing-content max-h-24 min-h-9 py-2 pl-4 text-[14px] leading-5"
          />
          <InputGroupAddon align="inline-end" className="self-end pb-1">
            {busy ? (
              <InputGroupButton size="icon-sm" variant="outline" className="rounded-full border-2 border-ink" aria-label="Stop" onClick={() => void stop()}>
                <Square className="size-3 fill-current" />
              </InputGroupButton>
            ) : (
              <InputGroupButton
                type="submit"
                size="icon-sm"
                disabled={!input.trim()}
                className="rounded-full border-2 border-ink bg-[#1d6ff4] text-white hover:bg-[#1a62d8] hover:text-white"
                aria-label="Send"
              >
                <ArrowUp className="size-4" strokeWidth={3} />
              </InputGroupButton>
            )}
          </InputGroupAddon>
        </InputGroup>
      </form>
    </div>
  );
}

function hasText(m: ThreadMessage) {
  return m.parts.some((p) => p.type === "text" && p.text.trim().length > 0);
}

/** Whirring… Thinking… Ideating… — a shimmering word that changes while the bot works. */
function Thinking({ bot }: { bot: Bot }) {
  const [i, setI] = useState(() => Math.floor(Math.random() * THINKING_WORDS.length));
  useEffect(() => {
    const t = window.setInterval(() => setI((n) => (n + 1) % THINKING_WORDS.length), 1800);
    return () => window.clearInterval(t);
  }, []);
  return (
    <Message align="start">
      <MessageAvatar className="mt-0.5 self-start">
        <BotAvatar bot={{ ...bot, status: "working" }} size={26} animated />
      </MessageAvatar>
      <MessageContent>
        <Marker role="status" aria-live="polite" className="pt-1 text-ink-muted">
          <MarkerIcon>
            <Spinner className="size-3.5" />
          </MarkerIcon>
          <MarkerContent key={i} className="shimmer animate-in fade-in font-mono text-[13px] duration-300">
            {THINKING_WORDS[i]}…
          </MarkerContent>
        </Marker>
      </MessageContent>
    </Message>
  );
}

/** The bot's name, on the first line so it lines up with the avatar beside it. */
function SenderName({ bot }: { bot: Bot }) {
  return <span className="font-mono text-[12px] leading-none text-ink-muted">{bot.name}</span>;
}

function ChatMessage({ message, bot, streaming }: { message: ThreadMessage; bot: Bot; streaming: boolean }) {
  if (message.role === "user") {
    const text = message.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
    return (
      <Message align="end">
        <MessageContent>
          <Bubble align="end" variant="outline">
            <BubbleContent className="rounded-[14px] rounded-tr-sm border-ink/25 !bg-honey text-[13.5px] whitespace-pre-wrap text-ink">
              {text}
            </BubbleContent>
          </Bubble>
        </MessageContent>
      </Message>
    );
  }
  return (
    <Message align="start">
      <MessageAvatar className="mt-0.5 self-start">
        <BotAvatar bot={bot} size={26} />
      </MessageAvatar>
      <MessageContent className="gap-2">
        {!streaming && <SenderName bot={bot} />}
        {message.parts.map((part, i) => {
          if (part.type === "text") {
            if (!part.text.trim()) return null;
            return (
              <Streamdown key={i} isAnimating={streaming} className="text-[13.5px] leading-relaxed text-ink [&_a]:underline [&_code]:rounded [&_code]:bg-panel-sunken [&_code]:px-1">
                {part.text}
              </Streamdown>
            );
          }
          if (part.type.startsWith("tool-")) return <ToolChip key={i} part={part as ToolPart} />;
          return null;
        })}
      </MessageContent>
    </Message>
  );
}

function Greeting({ bot }: { bot: Bot }) {
  return (
    <div className="flex flex-col items-center gap-2 py-6 text-center">
      <BotAvatar bot={{ ...bot, status: "working" }} size={64} animated />
      <p className="text-[14px] font-bold">Say hi to {bot.name}</p>
      <p className="max-w-[260px] text-[12.5px] text-ink/70">
        {bot.role === "head"
          ? "Tell me what you want done — I'll plan it and hand tasks to the right floors."
          : "Ask about my work, or give me something to do. Big jobs become tasks on the board."}
      </p>
    </div>
  );
}

function Divider({ at }: { at: string }) {
  return (
    <Marker variant="separator" role="separator" className="font-mono text-[11.5px] text-ink-muted before:bg-hairline after:bg-hairline">
      <MarkerContent>New chat · {formatWhen(at)}</MarkerContent>
    </Marker>
  );
}

function formatWhen(at: string) {
  return new Date(at).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** Subtitle: what the bot currently remembers. */
function memoryNote(messages: ThreadMessage[]) {
  const lastDivider = [...messages].reverse().find((m) => m.metadata?.divider);
  return lastDivider ? `Remembers since ${formatWhen(lastDivider.metadata!.createdAt)}` : "Remembers this whole conversation";
}

type ToolPart = { type: string; state: string; input?: Record<string, unknown>; output?: Record<string, unknown> };

/** Compact line for each tool the bot used. */
function ToolChip({ part }: { part: ToolPart }) {
  const name = part.type.slice("tool-".length);
  if (isAppTool(name)) return <AppToolChip name={name} part={part} />;
  const done = part.state === "output-available";
  const failed = part.state === "output-error" || (done && part.output?.ok === false);
  let label: string;
  let Icon = ClipboardList;
  if (name === "create_task") {
    const title = String(part.output?.title ?? part.input?.title ?? "a task");
    const who = part.output?.assignee ? ` for ${String(part.output.assignee)}` : "";
    const queued = done && part.output?.started === false ? " · waiting to start" : done ? " · running" : "";
    label = failed ? `Couldn't create “${title}”: ${String(part.output?.error ?? "error")}` : done ? `Created task “${title}”${who}${queued}` : `Creating “${title}”…`;
  } else if (name === "update_notes") {
    Icon = NotebookPen;
    label = done ? "Updated notes" : "Updating notes…";
  } else if (name === "read_notes") {
    Icon = NotebookPen;
    label = done ? "Read notes" : "Reading notes…";
  } else if (name === "list_tasks") {
    label = done ? "Checked the board" : "Checking the board…";
  } else if (name === "propose_routine") {
    const routine = String(part.output?.proposed ?? part.input?.name ?? "a routine");
    label = failed
      ? `Couldn't propose “${routine}”: ${String(part.output?.error ?? "error")}`
      : done
        ? `Proposed routine “${routine}” · ${String(part.output?.schedule ?? "")} · waiting for your OK`
        : `Proposing “${routine}”…`;
  } else {
    label = name;
  }
  return (
    <Marker role={done || failed ? undefined : "status"} className={cn("font-mono text-[12px]", failed ? "text-[#b5473f]" : "text-ink-muted")}>
      <MarkerIcon>{done || failed ? <Icon className="size-3.5" /> : <Spinner className="size-3.5" />}</MarkerIcon>
      <MarkerContent className={cn(!done && !failed && "shimmer")}>{label}</MarkerContent>
    </Marker>
  );
}

/** An app action (any connected app): its logo(s) and "Notion · create page" instead of COMPOSIO_*. */
function AppToolChip({ name, part }: { name: string; part: ToolPart }) {
  const info = describeAppTool(name, part.input);
  const done = part.state === "output-available";
  const error = part.state === "output-error" || (done && part.output?.successful === false);
  const reason = String(part.output?.error ?? "");
  const label = error
    ? /approval/i.test(reason)
      ? `${info.done} — needs your approval`
      : /rejected|NOT done/i.test(reason)
        ? `${info.done} — you said no`
        : `${info.done} — didn't work`
    : done
      ? info.done
      : info.running;
  return (
    <Marker
      role={done || error ? undefined : "status"}
      className={cn("font-mono text-[12px]", error ? "text-[#b5473f]" : info.lookup ? "text-ink-muted/80" : "text-ink-muted")}
    >
      <MarkerIcon>
        {!done && !error ? (
          <Spinner className="size-3.5" />
        ) : info.apps.length ? (
          <span className="flex -space-x-1">
            {info.apps.slice(0, 3).map((app) => (
              // eslint-disable-next-line @next/next/no-img-element -- third-party app logos from Composio's CDN
              <img key={app.slug} src={app.logo} alt={app.name} title={app.name} className="size-3.5 rounded-[3px] bg-white object-contain" loading="lazy" />
            ))}
          </span>
        ) : (
          <Search className="size-3.5" />
        )}
      </MarkerIcon>
      <MarkerContent className={cn(!done && !error && "shimmer")}>{label}</MarkerContent>
    </Marker>
  );
}

/** Server errors arrive as JSON `{ error }` or plain text. */
function readError(error: Error) {
  try {
    const parsed = JSON.parse(error.message) as { error?: string };
    if (parsed.error) return parsed.error;
  } catch {
    /* not JSON */
  }
  return /fetch|network/i.test(error.message) ? "Couldn't reach the server — check your connection and try again." : error.message;
}

/** Placeholder bubbles while the conversation loads. */
function ChatSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      <LoadingLabel>Loading the conversation…</LoadingLabel>
      <div className="flex items-start gap-2">
        <Skeleton className="size-7 shrink-0 rounded-full" />
        <div className="flex w-[70%] flex-col gap-1.5">
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-4/5" />
        </div>
      </div>
      <Skeleton className="h-9 w-[55%] self-end rounded-[14px]" />
      <div className="flex items-start gap-2">
        <Skeleton className="size-7 shrink-0 rounded-full" />
        <div className="flex w-[60%] flex-col gap-1.5">
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-2/3" />
          <Skeleton className="h-3 w-5/6" />
        </div>
      </div>
    </div>
  );
}
