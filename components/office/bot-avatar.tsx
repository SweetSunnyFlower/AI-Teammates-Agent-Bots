"use client";

import { Avatar } from "@bible-strong/avatar-react";
import { avatarDefinitionFor } from "@/lib/avatars/definitions";
import { STATUS_META } from "@/lib/office/status";
import type { Bot } from "@/lib/office/types";

/**
 * Bot avatar from bible-strong-avatar-lab.
 * `animated` plays the status animation (3D office); otherwise it shows a still
 * status expression (panels), which keeps dozens of avatars cheap.
 */
export function BotAvatar({
  bot,
  size,
  animated = false,
  className,
}: {
  bot: Pick<Bot, "name" | "status" | "avatar">;
  size: number;
  animated?: boolean;
  className?: string;
}) {
  const definition = avatarDefinitionFor(bot.avatar);
  const meta = STATUS_META[bot.status];
  const label = `${bot.name}, ${meta.label}`;

  return animated ? (
    <Avatar definition={definition} animation={meta.animation} size={size} ariaLabel={label} className={className} />
  ) : (
    <Avatar definition={definition} expression={meta.expression} size={size} ariaLabel={label} className={className} />
  );
}
