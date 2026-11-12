"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { Bell, Building2, Check, ChevronDown, LayoutGrid, LogOut, Plus, Repeat, Settings } from "lucide-react";
import { signOut } from "@/app/(routes)/auth/actions";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";
import { countByStatus } from "@/lib/office/status";
import type { BotStatus, Workspace } from "@/lib/office/types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { BotStatusIndicator } from "./bot-status";
import type { RevealSection } from "./office-provider";

const SUMMARY: Array<[BotStatus, string]> = [
  ["working", "Working"],
  ["waiting", "Waiting"],
  ["error", "Error"],
  ["resting", "Resting"],
];

/**
 * Header from dotty-home.jpg: workspace pill + live status counts on the left, actions on the right.
 * On the office page Waiting on me / Routines scroll to their panels; elsewhere they link back.
 */
export function TopBar({
  workspace,
  workspaces,
  statuses,
  waitingCount,
  active,
  onReveal,
  onAddBot,
  boardButton,
  onOpenSettings,
  className,
}: {
  workspace: Workspace;
  workspaces: Workspace[];
  statuses: BotStatus[];
  waitingCount: number;
  active: "office" | "boards";
  onReveal?: (section: RevealSection) => void;
  /** Opens the bot dialog in place; without it, + Bot links to the office (#add-bot). */
  onAddBot?: () => void;
  /** The Boards control (the office passes its dialog toggle). */
  boardButton?: ReactNode;
  /** Opens the settings dialog (connectors…). */
  onOpenSettings?: () => void;
  className?: string;
}) {
  const counts = countByStatus(statuses);
  const officeHref = `/workspace/${workspace.id}`;

  const revealButton = (section: RevealSection, children: ReactNode, extra?: string) =>
    onReveal ? (
      <button type="button" className={cn("fn-sticker", extra)} onClick={() => onReveal(section)}>
        {children}
      </button>
    ) : (
      <Link href={`${officeHref}#${section}`} className={cn("fn-sticker", extra)}>
        {children}
      </Link>
    );

  return (
    <header className={cn("flex flex-wrap items-center gap-3", className)}>
      <WorkspaceSwitcher current={workspace} workspaces={workspaces} />

      <div className="fn-sticker h-12 gap-4 px-4 font-semibold" role="status" aria-label="Bot status counts">
        {SUMMARY.map(([s, label]) => (
          <span key={s} className={cn("flex items-center gap-1.5", counts[s] === 0 && "opacity-55")}>
            <BotStatusIndicator status={s} active={counts[s] > 0} className="size-2.5" />
            <span>
              {counts[s]} {label}
            </span>
          </span>
        ))}
      </div>

      <nav className="ml-auto flex flex-wrap items-center gap-2.5" aria-label="Office actions">
        {revealButton(
          "waiting",
          <>
            <Bell className="size-4.5" />
            Waiting on me
            {waitingCount > 0 && (
              <span className="grid h-6 min-w-6 place-items-center rounded-full border-2 border-ink bg-[#dd6d62] px-1 text-[12px] text-white">
                {waitingCount}
              </span>
            )}
          </>,
          "bg-[#facf73] text-[#2b2620]",
        )}

        {boardButton ? (
          boardButton
        ) : active === "boards" ? (
          <Link href={officeHref} className="fn-sticker">
            <Building2 className="size-4.5" /> Office
          </Link>
        ) : (
          <Link href={`${officeHref}?board=1`} className="fn-sticker">
            <LayoutGrid className="size-4.5" /> Boards
          </Link>
        )}

        {revealButton(
          "routines",
          <>
            <Repeat className="size-4.5" /> Routines
          </>,
        )}

        {onAddBot ? (
          <button type="button" className="fn-sticker bg-[#1d6ff4] text-white" onClick={onAddBot}>
            <Plus className="size-4.5" strokeWidth={3} /> Bot
          </button>
        ) : workspace.id !== "demo" ? (
          <Link href={`${officeHref}#add-bot`} className="fn-sticker bg-[#1d6ff4] text-white">
            <Plus className="size-4.5" strokeWidth={3} /> Bot
          </Link>
        ) : (
          <Tooltip>
            <TooltipTrigger className="fn-sticker bg-[#1d6ff4] text-white opacity-70" aria-label="Add a bot">
              <Plus className="size-4.5" strokeWidth={3} /> Bot
            </TooltipTrigger>
            <TooltipContent>Sign in to add bots — this is the demo office</TooltipContent>
          </Tooltip>
        )}
        <Tooltip>
          <TooltipTrigger
            className="fn-sticker w-11 justify-center bg-[#fede8c] px-0 text-[#2b2620]"
            aria-label="Settings"
            onClick={onOpenSettings}
            disabled={!onOpenSettings}
          >
            <Settings className="size-5" />
          </TooltipTrigger>
          <TooltipContent>{onOpenSettings ? "Settings & connectors" : "Sign in to change settings"}</TooltipContent>
        </Tooltip>
        <ThemeToggle />
        <form action={signOut}>
          <Tooltip>
            <TooltipTrigger type="submit" className="fn-sticker w-11 justify-center px-0" aria-label="Sign out">
              <LogOut className="size-5" />
            </TooltipTrigger>
            <TooltipContent>Sign out</TooltipContent>
          </Tooltip>
        </form>
      </nav>
    </header>
  );
}

/** Header workspace pill: lists every workspace you own and lets you open a new one. */
function WorkspaceSwitcher({ current, workspaces }: { current: Workspace; workspaces: Workspace[] }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="fn-sticker h-12 gap-2.5 pl-1.5 text-[18px]" aria-label={`Workspace: ${current.name}. Switch workspace`}>
        <WorkspaceIcon icon={current.icon} />
        <span className="max-w-[220px] truncate">{current.name}</span>
        <ChevronDown className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={8}
        className="w-[280px] rounded-[14px] border-2 border-ink bg-panel p-1.5 text-ink shadow-[0_4px_0_0_var(--lip)] ring-0"
      >
        <DropdownMenuGroup>
          <DropdownMenuLabel className="px-2 font-mono text-[12px] text-ink-muted">your workspaces</DropdownMenuLabel>
          {workspaces.map((w) => (
            <DropdownMenuItem
              key={w.id}
              render={<Link href={`/workspace/${w.id}`} />}
              className="gap-2.5 rounded-[10px] px-2 py-1.5 text-[15px] font-semibold focus:bg-panel-sunken"
            >
              <WorkspaceIcon icon={w.icon} small />
              <span className="min-w-0 flex-1 truncate">{w.name}</span>
              {w.id === current.id && <Check className="size-4 text-status-working" strokeWidth={3} />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator className="my-1.5 bg-hairline" />
        <DropdownMenuItem
          render={<Link href="/workspace/new" />}
          className="justify-center gap-2 rounded-[10px] border-2 border-ink bg-[#1d6ff4] px-2 py-2 text-[14px] font-bold text-white shadow-[0_2px_0_0_var(--lip)] focus:bg-[#1a62d8] focus:text-white"
        >
          <Plus className="size-4" strokeWidth={3} /> Create workspace
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function WorkspaceIcon({ icon, small = false }: { icon: string; small?: boolean }) {
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center rounded-[9px] border-2 border-ink bg-chip-sky leading-none",
        small ? "size-8 text-[16px]" : "size-9 text-[18px]",
      )}
    >
      {icon}
    </span>
  );
}
