"use client";

import { useState, useTransition, type ReactNode } from "react";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Pencil, Plus, UserPlus } from "lucide-react";
import { reorderDepartments } from "@/app/(routes)/workspace/team-actions";
import { cn } from "@/lib/utils";
import { floorColors } from "@/lib/office/floors";
import { STATUS_META } from "@/lib/office/status";
import { BotAvatar } from "@/components/office/bot-avatar";
import { useOffice } from "@/components/office/office-provider";
import { InboxCard } from "@/components/inbox/inbox-card";
import { RoutineItem } from "@/components/routines/routine-item";
import { Panel, StatusDot } from "./panel";

type Section = "floors" | "waiting" | "finished" | "routines";
type AccordionProps = { open: boolean; onToggle: () => void };

/** Accordion: one panel open at a time; it fills the column and scrolls inside itself. */
export function LeftColumn() {
  const { reveal } = useOffice();
  const [open, setOpen] = useState<Section | null>("floors");

  // Header buttons (Waiting on me / Routines) open their panel and close the others.
  const [lastReveal, setLastReveal] = useState(reveal);
  if (reveal !== lastReveal) {
    setLastReveal(reveal);
    if (reveal) setOpen(reveal.section);
  }

  const props = (section: Section): AccordionProps => ({
    open: open === section,
    onToggle: () => setOpen((o) => (o === section ? null : section)),
  });

  return (
    <div className="flex min-h-0 flex-col gap-3 lg:h-full">
      <FloorsPanel {...props("floors")} />
      <WaitingPanel {...props("waiting")} />
      <FinishedPanel {...props("finished")} />
      <RoutinesPanel {...props("routines")} />
    </div>
  );
}

function FloorsPanel(accordion: AccordionProps) {
  const { snapshot, floors, botsByFloor, departmentById, focusedFloorId, focusFloor, canEdit, openEditor } = useOffice();
  const { refreshOffice } = useOffice();
  const departments = [...departmentById.values()];
  const [order, setOrder] = useState<string[] | null>(null); // optimistic order while saving
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const shown = order ? order.map((id) => floors.find((f) => f.id === id)!).filter(Boolean) : floors;
  const movable = shown.filter((f) => f.kind !== "head");

  /** Move a floor one level (+1 = up). The Head office always stays on top. */
  const move = (id: string, delta: 1 | -1) => {
    const bottomUp = [...movable].reverse().map((f) => f.id);
    const i = bottomUp.indexOf(id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= bottomUp.length) return;
    [bottomUp[i], bottomUp[j]] = [bottomUp[j], bottomUp[i]];
    const head = shown.filter((f) => f.kind === "head").map((f) => f.id);
    setOrder([...head, ...[...bottomUp].reverse()]);
    setError(null);
    startTransition(async () => {
      const res = await reorderDepartments(snapshot.workspace.id, bottomUp);
      if (!res.ok) {
        setError(res.error);
        toast.error("Couldn't reorder floors", { description: res.error });
      }
      void refreshOffice();
      setOrder(null);
    });
  };

  return (
    <Panel
      {...accordion}
      title="floors"
      dotColor="#8e7cc3"
      action={
        canEdit ? (
          <button type="button" className="fn-pill" onClick={() => openEditor({ type: "department" })} disabled={floors.length >= 20}>
            <Plus className="size-3.5" /> floor
          </button>
        ) : undefined
      }
    >
      {shown.length === 0 && <p className="px-1 py-2 font-mono text-[12.5px] text-ink-muted">no floors yet — add one to give bots a place to work.</p>}
      <ul className={cn("flex flex-col gap-0.5", pending && "opacity-70")}>
        {shown.map((dept) => {
          const bots = botsByFloor.get(dept.id) ?? [];
          const chip = floorColors(departments, dept.id).chip;
          const active = focusedFloorId === dept.id;
          const mi = movable.findIndex((f) => f.id === dept.id);
          return (
            <li key={dept.id} className="group/floor relative">
              <button
                type="button"
                onClick={() => focusFloor(active ? null : dept.id)}
                aria-pressed={active}
                title="Ride the elevator to this floor"
                className={cn(
                  "flex w-full items-center gap-3 rounded-[10px] px-2 py-1.5 text-left transition-colors hover:bg-panel-sunken",
                  active && "bg-panel-sunken",
                )}
              >
                <span
                  className="grid size-8 shrink-0 place-items-center rounded-[8px] border-[1.5px] border-ink/60 font-mono text-[13px] text-[#2b2620]"
                  style={{ backgroundColor: chip }}
                >
                  {dept.floorIndex}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-bold text-ink">{dept.name}</span>
                  <span className="mt-1 flex gap-1">
                    {bots.length ? (
                      bots.map((b) => <StatusDot key={b.id} color={STATUS_META[b.status].color} className="size-2" />)
                    ) : (
                      <span className="font-mono text-[11px] leading-none text-ink-muted">no bots yet</span>
                    )}
                  </span>
                </span>
                <span className={cn("font-mono text-[13px] text-ink-muted", canEdit && "group-hover/floor:opacity-0 group-focus-within/floor:opacity-0")}>
                  {bots.length}
                </span>
              </button>
              {canEdit && (
                <span className="absolute top-1/2 right-1.5 flex -translate-y-1/2 gap-0.5 opacity-0 transition-opacity group-hover/floor:opacity-100 group-focus-within/floor:opacity-100">
                  {dept.kind !== "head" && (
                    <>
                      <IconButton label={`Move ${dept.name} up`} disabled={pending || mi <= 0} onClick={() => move(dept.id, 1)}>
                        <ArrowUp className="size-3.5" />
                      </IconButton>
                      <IconButton label={`Move ${dept.name} down`} disabled={pending || mi === movable.length - 1} onClick={() => move(dept.id, -1)}>
                        <ArrowDown className="size-3.5" />
                      </IconButton>
                    </>
                  )}
                  <IconButton label={`Add a bot to ${dept.name}`} onClick={() => openEditor({ type: "bot", departmentId: dept.id })}>
                    <UserPlus className="size-3.5" />
                  </IconButton>
                  <IconButton label={`Edit ${dept.name}`} onClick={() => openEditor({ type: "department", departmentId: dept.id })}>
                    <Pencil className="size-3.5" />
                  </IconButton>
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {error && <p role="alert" className="px-2 pt-1 text-[12.5px] text-[#b5473f]">{error}</p>}
    </Panel>
  );
}

function IconButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="grid size-6 place-items-center rounded-[7px] border border-ink/40 bg-panel text-ink hover:bg-honey disabled:opacity-30 [&_svg]:size-3"
    >
      {children}
    </button>
  );
}

function WaitingPanel(accordion: AccordionProps) {
  const { snapshot, botById } = useOffice();
  const items = snapshot.inbox;
  return (
    <Panel {...accordion} title="waiting on me" dotColor={STATUS_META.waiting.color} count={items.length} revealKey="waiting">
      {items.length === 0 ? (
        <p className="px-1 py-2 font-mono text-[12.5px] text-ink-muted">nothing needs you right now.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((item) => {
            const bot = botById.get(item.botId);
            if (!bot) return null;
            return (
              <li key={item.id}>
                <InboxCard item={item} bot={bot} />
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

function FinishedPanel(accordion: AccordionProps) {
  const { snapshot, botById, openReply } = useOffice();
  return (
    <Panel {...accordion} title="finished" dotColor={STATUS_META.working.color} count={snapshot.finished.length}>
      {snapshot.finished.length === 0 && (
        <p className="px-1 py-2 font-mono text-[12.5px] text-ink-muted">finished work shows up here.</p>
      )}
      <ul className="flex flex-col">
        {snapshot.finished.map((f) => {
          const bot = botById.get(f.botId);
          if (!bot) return null;
          return (
            <li key={f.id}>
              <button
                type="button"
                onClick={() => openReply(bot.id, f.id)}
                title="Read the report"
                className="flex w-full gap-2.5 rounded-[10px] px-1.5 py-1.5 text-left hover:bg-panel-sunken"
              >
                <BotAvatar bot={{ ...bot, status: "working" }} size={26} className="mt-0.5 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-[14px] font-bold text-ink">{bot.name}</span>
                    <span className="shrink-0 font-mono text-[11.5px] text-ink-muted">{f.ago}</span>
                  </span>
                  <span className="block text-[13px] leading-snug text-ink/80">{f.summary}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

function RoutinesPanel(accordion: AccordionProps) {
  const { snapshot, canEdit, openEditor } = useOffice();
  return (
    <Panel
      {...accordion}
      title="routines"
      dotColor="#5c8fd6"
      count={snapshot.routines.length}
      revealKey="routines"
      action={
        canEdit && snapshot.bots.length > 0 ? (
          <button type="button" className="fn-pill" onClick={() => openEditor({ type: "routine" })} disabled={snapshot.routines.length >= 50}>
            <Plus className="size-3.5" /> routine
          </button>
        ) : undefined
      }
    >
      {snapshot.routines.length === 0 && (
        <p className="px-1 py-2 font-mono text-[12.5px] text-ink-muted">no routines yet — bots only run when asked.</p>
      )}
      <ul className="flex flex-col gap-2">
        {snapshot.routines.map((r) => (
          <li key={r.id} className="px-1.5">
            <RoutineItem routine={r} />
          </li>
        ))}
      </ul>
    </Panel>
  );
}
