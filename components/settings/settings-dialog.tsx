"use client";

import { Activity, useEffect, useRef, useState, useTransition } from "react";
import { keepPreviousData, useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Check, Loader2, Plug, Search, ShieldCheck, Unplug, X } from "lucide-react";
import { toast } from "sonner";
import { connectToolkit, disconnectToolkit, listConnectors, type ConnectorItem } from "@/app/(routes)/workspace/connector-actions";
import { useOffice, type SettingsTab } from "@/components/office/office-provider";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

const TABS: Array<{ id: SettingsTab; label: string; icon: typeof Plug }> = [
  { id: "connectors", label: "Connectors", icon: Plug },
  { id: "workspace", label: "Workspace", icon: Building2 },
];

/**
 * Settings (header gear). Mounted on first open, then kept alive in React <Activity>: closing only
 * hides it, so reopening is instant and keeps the loaded apps, search and scroll position.
 */
export function SettingsDialog() {
  const { settingsTab, openSettings, closeSettings, canEdit } = useOffice();
  const open = settingsTab !== null && canEdit;
  const [everOpened, setEverOpened] = useState(false);
  const [tab, setTab] = useState<SettingsTab>("connectors");
  const panelRef = useRef<HTMLDivElement>(null);

  // Derived during render: remember the first open and follow tab requests (e.g. ?settings=connectors).
  if (open && !everOpened) setEverOpened(true);
  if (settingsTab && settingsTab !== tab) setTab(settingsTab);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeSettings();
    window.addEventListener("keydown", onKey);
    panelRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [open, closeSettings]);

  if (!everOpened || !canEdit) return null;

  return (
    <Activity mode={open ? "visible" : "hidden"} name="settings">
      <div className="fixed inset-0 z-50 grid place-items-center p-3">
        <div className="animate-in fade-in absolute inset-0 bg-[#1f1a12]/40 backdrop-blur-[2px] duration-150" onClick={closeSettings} aria-hidden />
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="settings-title"
          tabIndex={-1}
          className="animate-in fade-in zoom-in-95 relative flex w-full max-w-[880px] flex-col overflow-hidden rounded-[18px] border-2 border-ink bg-panel text-ink shadow-[0_5px_0_0_var(--lip)] duration-150 outline-none"
          // Inline so it never depends on generated utility classes: fits the window, scrolls inside.
          style={{
            height: "min(680px, calc(100dvh - 24px))",
            maxHeight: "calc(100dvh - 24px)",
            minHeight: "min(420px, calc(100dvh - 24px))",
          }}
        >
          <header className="flex shrink-0 items-start justify-between gap-3 border-b border-hairline px-6 pt-5 pb-4">
            <div>
              <p className="font-mono text-[12px] text-ink-muted">workspace settings</p>
              <h2 id="settings-title" className="text-[22px] leading-tight font-extrabold">
                Settings
              </h2>
            </div>
            <button type="button" onClick={closeSettings} aria-label="Close settings" className="grid size-9 place-items-center rounded-[10px] text-ink-muted hover:bg-panel-sunken hover:text-ink">
              <X className="size-5" />
            </button>
          </header>

          <Tabs
            orientation="vertical"
            value={tab}
            onValueChange={(v) => openSettings(v as SettingsTab)}
            className="min-h-0 flex-1 flex-row gap-0 overflow-hidden"
          >
            <TabsList
              variant="line"
              className="h-auto w-48 shrink-0 flex-col items-stretch justify-start gap-1 rounded-none border-r border-hairline p-3"
            >
              {TABS.map(({ id, label, icon: Icon }) => (
                <TabsTrigger
                  key={id}
                  value={id}
                  className="h-9 flex-none justify-start gap-2 rounded-[10px] px-3 text-[14px] font-semibold text-ink/75 after:hidden data-active:bg-honey data-active:text-ink"
                >
                  <Icon className="size-4" /> {label}
                </TabsTrigger>
              ))}
            </TabsList>
            <TabsContent value="connectors" className="flex min-h-0 flex-col overflow-hidden">
              <Connectors />
            </TabsContent>
            <TabsContent value="workspace" className="min-h-0 overflow-y-auto px-1">
              <WorkspaceSoon />
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </Activity>
  );
}

/** Cached per workspace + search (TanStack Query): switching tabs or reopening shows it instantly. */
function useConnectors(workspaceId: string, search: string) {
  return useInfiniteQuery({
    queryKey: ["connectors", workspaceId, search],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const res = await listConnectors(workspaceId, { search, cursor: pageParam });
      if (!res.ok) throw Object.assign(new Error(res.error), { setup: res.setup });
      return res;
    },
    getNextPageParam: (last) => last.cursor ?? undefined,
    staleTime: 5 * 60_000,
    placeholderData: keepPreviousData, // keep showing results while a new search loads
  });
}

function Connectors() {
  const { snapshot } = useOffice();
  const workspaceId = snapshot.workspace.id;
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");

  // Debounce typing into a search.
  useEffect(() => {
    const t = setTimeout(() => setSearch(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  const { data, error, isPending, isFetching, fetchNextPage, hasNextPage, isFetchingNextPage } = useConnectors(workspaceId, search);
  const seen = new Set<string>();
  const items = (data?.pages.flatMap((p) => p.items) ?? []).filter((i) => (seen.has(i.slug) ? false : (seen.add(i.slug), true)));
  const setup = Boolean((error as { setup?: boolean } | null)?.setup);

  // After a disconnect: update every cached page right away, then refresh in the background.
  const markDisconnected = (slug: string) => {
    queryClient.setQueriesData<typeof data>({ queryKey: ["connectors", workspaceId] }, (old) =>
      old
        ? { ...old, pages: old.pages.map((p) => ({ ...p, items: p.items.map((i) => (i.slug === slug ? { ...i, connected: false, accountId: null } : i)) })) }
        : old,
    );
    void queryClient.invalidateQueries({ queryKey: ["connectors", workspaceId] });
    void queryClient.invalidateQueries({ queryKey: ["connected-apps", workspaceId] });
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-col gap-4 px-6 pt-5 pb-3">
        <div>
          <h3 className="text-[17px] font-extrabold">Connectors</h3>
          <p className="mt-1 text-[13px] leading-snug text-ink/75">
            Connect the apps your bots can use — Gmail, Notion, GitHub and many more. Connections belong to this workspace, so every bot here can use them.
          </p>
        </div>

        <p className="flex items-start gap-2 rounded-[12px] border-2 border-ink/20 bg-ok-bg px-3 py-2 text-[12.5px] leading-snug">
          <ShieldCheck className="mt-0.5 size-4 shrink-0" />
          <span>
            For now bots can only <b>read</b> from connected apps. Anything that sends, posts, edits or deletes stays blocked until approvals arrive — then it
            will always ask you first.
          </span>
        </p>

        <InputGroup className="h-10 rounded-[10px] border-2 border-ink/60 bg-field">
          <InputGroupAddon align="inline-start" className="pl-3 text-ink-muted">
            {isFetching && !isFetchingNextPage ? <Spinner className="size-4" /> : <Search className="size-4" />}
          </InputGroupAddon>
          <InputGroupInput
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search apps — gmail, notion, github, slack…"
            aria-label="Search apps"
            className="text-[14px]"
          />
        </InputGroup>
      </div>

      {/* Only the list scrolls; the header and search stay put. */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-hairline py-4 pr-4 pl-6 [scrollbar-gutter:stable] [scrollbar-width:thin]">
        {error ? (
          <p role="alert" className={cn("rounded-[10px] px-3 py-2 text-[13px]", setup ? "bg-honey" : "bg-danger-bg")}>
            {error.message}
          </p>
        ) : isPending ? (
          <p className="flex items-center gap-2 font-mono text-[12.5px] text-ink-muted">
            <Spinner className="size-3.5" /> loading apps…
          </p>
        ) : items.length === 0 ? (
          <p className="font-mono text-[12.5px] text-ink-muted">no apps match “{search}”.</p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {items.map((item) => (
              <ConnectorRow key={item.slug} item={item} workspaceId={workspaceId} onDisconnected={() => markDisconnected(item.slug)} />
            ))}
          </ul>
        )}

        {hasNextPage && !error && (
          <div className="flex justify-center pt-3">
            <button type="button" onClick={() => void fetchNextPage()} disabled={isFetchingNextPage} className="fn-pill">
              {isFetchingNextPage ? <Loader2 className="size-3.5 animate-spin" /> : null} Load more apps
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ConnectorRow({ item, workspaceId, onDisconnected }: { item: ConnectorItem; workspaceId: string; onDisconnected: () => void }) {
  const [pending, startTransition] = useTransition();
  const [confirm, setConfirm] = useState(false);

  const connect = () =>
    startTransition(async () => {
      const res = await connectToolkit(workspaceId, item.slug);
      if (!res.ok) return void toast.error(`Couldn't connect ${item.name}`, { description: res.error });
      window.location.assign(res.redirectUrl); // Composio's sign-in page; it returns here when done
    });

  const disconnect = () =>
    startTransition(async () => {
      const res = await disconnectToolkit(workspaceId, item.slug);
      if (!res.ok) return void toast.error(`Couldn't disconnect ${item.name}`, { description: res.error });
      toast.success(`${item.name} disconnected`);
      setConfirm(false);
      onDisconnected();
    });

  return (
    <li className={cn("flex items-center gap-3 rounded-[12px] border-2 bg-field p-3", item.connected ? "border-ink/70" : "border-ink/20")}>
      <span className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-[9px] border border-hairline bg-white">
        {item.logo ? (
          // eslint-disable-next-line @next/next/no-img-element -- third-party app logos from Composio's CDN
          <img src={item.logo} alt="" className="size-6 object-contain" loading="lazy" />
        ) : (
          <Plug className="size-4 text-ink-muted" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-bold">{item.name}</span>
        <span className={cn("flex items-center gap-1 font-mono text-[11.5px]", item.connected ? "text-[#2e8b3e]" : "text-ink-muted")}>
          {item.connected ? (
            <>
              <Check className="size-3" strokeWidth={3} /> connected
            </>
          ) : item.noAuth ? (
            "no sign-in needed"
          ) : (
            "not connected"
          )}
        </span>
      </span>
      {item.connected ? (
        confirm ? (
          <span className="flex shrink-0 gap-1">
            <button type="button" onClick={disconnect} disabled={pending} className="fn-pill border-[#b5473f] bg-[#dd6d62] px-2.5 text-white">
              {pending ? <Loader2 className="size-3.5 animate-spin" /> : "Disconnect"}
            </button>
            <button type="button" onClick={() => setConfirm(false)} className="fn-pill px-2.5">
              Keep
            </button>
          </span>
        ) : (
          <button type="button" onClick={() => setConfirm(true)} className="fn-pill shrink-0 px-2.5" aria-label={`Disconnect ${item.name}`}>
            <Unplug className="size-3.5" />
          </button>
        )
      ) : item.noAuth ? null : (
        <button type="button" onClick={connect} disabled={pending} className="fn-sticker h-8 shrink-0 bg-[#1d6ff4] px-3 text-[13px] text-white">
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : null} Connect
        </button>
      )}
    </li>
  );
}

function WorkspaceSoon() {
  return (
    <div className="px-6 py-5">
      <h3 className="text-[17px] font-extrabold">Workspace</h3>
      <p className="mt-1 text-[13px] text-ink/75">Spend cap, task cap and recap time settings are coming next.</p>
    </div>
  );
}
