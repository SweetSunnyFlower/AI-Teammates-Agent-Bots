"use client";

import { useState } from "react";
import { ArrowUp } from "lucide-react";
import { BotAvatar } from "@/components/office/bot-avatar";
import { useOffice } from "@/components/office/office-provider";

/** Always-visible "Ask the Head" box: opens the Head bot's chat and sends the message there. */
export function AskHead() {
  const { snapshot, canEdit, askBot } = useOffice();
  const [text, setText] = useState("");
  const head = snapshot.bots.find((b) => b.role === "head");
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
      className="fn-sticker pointer-events-auto h-12 w-[min(480px,92vw)] gap-2 rounded-full pr-1.5 pl-1.5 font-normal"
    >
      <BotAvatar bot={head} size={34} className="shrink-0" />
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={4000}
        placeholder={`Ask ${head.name} to…`}
        aria-label={`Ask ${head.name}`}
        className="min-w-0 flex-1 bg-transparent text-[14.5px] text-ink outline-none placeholder:text-ink-muted"
      />
      <button
        type="submit"
        disabled={!text.trim()}
        aria-label="Send to the Head"
        className="grid size-9 shrink-0 place-items-center rounded-full border-2 border-ink bg-[#1d6ff4] text-white disabled:opacity-40"
      >
        <ArrowUp className="size-4" strokeWidth={3} />
      </button>
    </form>
  );
}
