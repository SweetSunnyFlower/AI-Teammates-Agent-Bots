"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { ArrowUp, ClipboardList, Loader2, MessageCircleQuestion, NotebookPen, RotateCcw, Square, SquarePen } from "lucide-react";
import { toast } from "sonner";
import { Streamdown } from "streamdown";
import { answerQuestion, loadThread, startNewChat, type ThreadMessage } from "@/app/(routes)/workspace/chat-actions";
import { createClient } from "@/lib/supabase/client";
import { BotAvatar } from "@/components/office/bot-avatar";
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
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { Bot, InboxItem } from "@/lib/office/types";

/** Words the bot "says" while it works on a reply (shimmering, like Claude's). */
const THINKING_WORDS = ["Whirring", "Thinking", "Ideating", "Unraveling", "Pondering", "Tinkering", "Noodling", "Percolating", "Scheming", "Brewing"];

/** One continuous thread per bot. "New chat" adds a divider; the bot only remembers what's below it. */
export function BotChat({ bot }: { bot: Bot }) {
  const { canEdit, snapshot, pendingAsk, clearPendingAsk, focusMessage, clearFocusMessage } = useOffice();
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const router = useRouter();
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [input, setInput] = useState("");

  const transport = useMemo(
    () =>
      new DefaultChatTransport<ThreadMessage>({
        api: `/api/chat/${bot.id}`,
        // The server keeps the thread; send only the new message.
        prepareSendMessagesRequest: ({ messages }) => ({ body: { message: messages[messages.length - 1] } }),
      }),
    [bot.id],
  );

  const { messages, setMessages, sendMessage, status, error, stop, regenerate, clearError } = useChat<ThreadMessage>({
    id: `bot-${bot.id}`,
    transport,
    onFinish: ({ message }) => {
      // A task was created → refresh the board counts / activity.
      if (message.parts.some((p) => p.type === "tool-create_task")) router.refresh();
    },
  });

  // Load the saved thread when the chat opens.
  useEffect(() => {
    if (!canEdit) return;
    let cancelled = false;
    loadThread(bot.id).then((res) => {
      if (cancelled) return;
      if (res.ok) setMessages(res.messages);
      else setLoadError(res.error);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [bot.id, canEdit, setMessages]);

  // Live thread: run reports (and messages from other tabs) appear without a reload.
  useEffect(() => {
    if (!canEdit || !loaded) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`thread:${bot.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `bot_id=eq.${bot.id}` }, (payload) => {
        const row = payload.new as { id: string; ui_id: string | null; role: ThreadMessage["role"]; kind: string; parts: ThreadMessage["parts"]; created_at: string };
        const id = row.ui_id ?? row.id;
        setMessages((current) =>
          current.some((m) => m.id === id)
            ? current
            : [...current, { id, role: row.role, parts: row.kind === "divider" ? [] : row.parts, metadata: { createdAt: row.created_at, divider: row.kind === "divider" || undefined } }],
        );
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [bot.id, canEdit, loaded, setMessages]);

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

  // "Ask the Head" hands its message over once the thread is loaded.
  useEffect(() => {
    if (!loaded || !pendingAsk || pendingAsk.botId !== bot.id) return;
    clearPendingAsk();
    void sendMessage({ text: pendingAsk.text });
  }, [loaded, pendingAsk, bot.id, clearPendingAsk, sendMessage]);

  const busy = status === "submitted" || status === "streaming";
  const last = messages[messages.length - 1];
  // Show the thinking shimmer until the reply's first words arrive.
  const thinking = status === "submitted" || (status === "streaming" && !(last?.role === "assistant" && hasText(last)));
  const questions = snapshot.inbox.filter((i) => i.botId === bot.id && i.kind === "question");

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
                <p className="flex items-center gap-2 font-mono text-[12px] text-ink-muted">
                  <Loader2 className="size-3.5 animate-spin" /> loading the conversation…
                </p>
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

              {questions.map((q) => (
                <MessageScrollerItem key={q.id} messageId={`q-${q.id}`}>
                  <QuestionCard item={q} bot={bot} />
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
      <MessageAvatar>
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
      <MessageAvatar>
        <BotAvatar bot={bot} size={26} />
      </MessageAvatar>
      <MessageContent className="gap-2">
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

/** A bot's question with its own reply box — the answer is tied to this question. */
function QuestionCard({ item, bot }: { item: InboxItem; bot: Bot }) {
  const router = useRouter();
  const [answer, setAnswer] = useState("");
  const [pending, startTransition] = useTransition();
  const submit = () =>
    startTransition(async () => {
      const res = await answerQuestion(item.id, answer);
      if (!res.ok) return void toast.error("Couldn't send your answer", { description: res.error });
      toast.success(`Answer sent to ${bot.name}`);
      setAnswer("");
      router.refresh();
    });
  return (
    <div className="rounded-[12px] border-2 border-ink/70 bg-honey p-3">
      <p className="flex items-center gap-1.5 font-mono text-[11.5px] text-ink/70">
        <MessageCircleQuestion className="size-3.5" /> {bot.name} asks
      </p>
      <p className="mt-1 text-[14px] font-bold">{item.title}</p>
      {item.preview && <p className="mt-0.5 text-[13px] text-ink/80">{item.preview}</p>}
      <form
        className="mt-2 flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (answer.trim()) submit();
        }}
      >
        <Textarea
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          rows={2}
          maxLength={4000}
          placeholder="Your answer…"
          aria-label={`Answer ${bot.name}'s question`}
          className="min-h-12 resize-none rounded-[10px] border-2 border-ink/50 bg-field text-[13.5px]"
        />
        <button type="submit" disabled={pending || !answer.trim()} className="fn-pill shrink-0 border-ink bg-ink text-panel">
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : "Answer"}
        </button>
      </form>
    </div>
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
