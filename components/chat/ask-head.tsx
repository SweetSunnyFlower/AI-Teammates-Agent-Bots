"use client";

import { useState } from "react";
import { ArrowUp } from "lucide-react";
import { BotAvatar } from "@/components/office/bot-avatar";
import { useOffice } from "@/components/office/office-provider";
import { cn } from "@/lib/utils";

/** Always-visible "Ask the Head" box: opens the Head bot's chat and sends the message there. */
export function AskHead() {
  const { snapshot, canEdit, askBot } = useOffice();
  const [text, setText] = useState("");
  const head = snapshot.bots.find((b) => b.role === "head");
  // Long or multi-line prompts turn the pill into a rounded box.
  const multiline = text.includes("\n") || text.length > 55;
  if (!head || !canEdit) return null;

  const submit = () => {
    const message = text.trim();
    if (!message) return;
    askBot(head.id, message);
    setText("");
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className={cn(
        "fn-sticker pointer-events-auto h-auto min-h-12 w-[min(520px,92vw)] items-end gap-2 py-1.5 pr-1.5 pl-1.5 font-normal transition-[border-radius]",
        multiline ? "rounded-[24px]" : "rounded-full",
      )}
    >
      <BotAvatar bot={head} size={34} className="shrink-0" />
      {/* Grows with the text (up to ~8 lines, then scrolls). Enter sends, Shift+Enter adds a line. */}
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
        rows={1}
        maxLength={4000}
        placeholder={`让 ${head.name} 帮你做…`}
        aria-label={`向 ${head.name} 提问（Enter 发送，Shift+Enter 换行）`}
        className="field-sizing-content scrollbar-thin max-h-48 whitespace-pre-wrap min-h-[34px] min-w-0 flex-1 resize-none self-center bg-transparent py-[7px] text-[14.5px] leading-5 text-ink outline-none placeholder:text-ink-muted"
      />
      <button
        type="submit"
        disabled={!text.trim()}
        aria-label="发送给总控 Bot"
        className="grid size-9 shrink-0 place-items-center rounded-full border-2 border-ink bg-[#1d6ff4] text-white disabled:opacity-40"
      >
        <ArrowUp className="size-4" strokeWidth={3} />
      </button>
    </form>
  );
}
