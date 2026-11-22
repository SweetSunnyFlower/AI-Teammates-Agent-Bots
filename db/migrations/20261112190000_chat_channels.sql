-- Telegram and Slack (Chat SDK, Phase 8–9).

-- ─── Chat SDK state (@chat-adapter/state-pg) ──────────────────────────────────────────────────
-- Same tables the adapter would create itself (`autoCreateSchema` is off so the schema is ours).
-- They hold webhook dedupe records, locks, thread state and Slack installations (bot tokens,
-- encrypted with SLACK_ENCRYPTION_KEY). The server connects as the database owner through
-- DATABASE_URL; RLS is on with no policies and the compatibility API roles get no privileges.
create table if not exists public.chat_state_subscriptions (
  key_prefix text not null,
  thread_id text not null,
  created_at timestamptz not null default now(),
  primary key (key_prefix, thread_id)
);
create table if not exists public.chat_state_locks (
  key_prefix text not null,
  thread_id text not null,
  token text not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (key_prefix, thread_id)
);
create table if not exists public.chat_state_cache (
  key_prefix text not null,
  cache_key text not null,
  value text not null,
  expires_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (key_prefix, cache_key)
);
create index if not exists chat_state_locks_expires_idx on public.chat_state_locks (expires_at);
create index if not exists chat_state_cache_expires_idx on public.chat_state_cache (expires_at);
create table if not exists public.chat_state_lists (
  key_prefix text not null,
  list_key text not null,
  seq bigserial not null,
  value text not null,
  expires_at timestamptz,
  primary key (key_prefix, list_key, seq)
);
create index if not exists chat_state_lists_expires_idx on public.chat_state_lists (expires_at);
create table if not exists public.chat_state_queues (
  key_prefix text not null,
  thread_id text not null,
  seq bigserial not null,
  value text not null,
  expires_at timestamptz not null,
  primary key (key_prefix, thread_id, seq)
);
create index if not exists chat_state_queues_expires_idx on public.chat_state_queues (expires_at);

alter table public.chat_state_subscriptions enable row level security;
alter table public.chat_state_locks enable row level security;
alter table public.chat_state_cache enable row level security;
alter table public.chat_state_lists enable row level security;
alter table public.chat_state_queues enable row level security;
revoke all on public.chat_state_subscriptions, public.chat_state_locks, public.chat_state_cache,
  public.chat_state_lists, public.chat_state_queues from anon, authenticated;
revoke all on sequence public.chat_state_lists_seq_seq, public.chat_state_queues_seq_seq from anon, authenticated;

-- ─── Linking ──────────────────────────────────────────────────────────────────────────────────
-- A Telegram link code is made in one workspace's settings and links that workspace.
alter table public.telegram_link_codes
  add column workspace_id uuid references public.workspaces (id) on delete cascade;

-- One Telegram account / one Slack workspace talks to one Dotty workspace at a time.
create unique index connections_provider_external_unique
  on public.connections (provider, external_id)
  where provider in ('telegram', 'slack') and external_id is not null;
