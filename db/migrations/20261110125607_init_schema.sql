-- Dotty v1 schema (docs/plans/2026-11-09-dotty-v1.md §5)
--
-- Access model: one owner per workspace. Every workspace-scoped row is visible only to the
-- workspace owner. The browser never writes directly; server actions use a user-scoped database
-- client that adds ownership predicates. Agent-runtime tables (runs, activity, inbox_items, recaps,
-- connections) are read-only for users and written by the trusted background runtime client.
--
-- Security notes (self-hosted PostgreSQL compatibility schema):
--   * RLS enabled on every table; policies use `to authenticated` + an ownership predicate.
--   * `(select auth.uid())` is wrapped in a sub-select so Postgres evaluates it once per query.
--   * UPDATE policies have both USING and WITH CHECK (rows can't be moved to another workspace).
--   * No SECURITY DEFINER functions; create_workspace runs as the caller with RLS applied.
--   * Composite foreign keys keep child rows in the same workspace as their parents.
--   * anon gets no table privileges at all.

-- ─── Enums ──────────────────────────────────────────────────────────────────────────────────────
create type public.department_kind as enum ('head', 'assistant', 'research', 'engineering', 'custom');
create type public.bot_role as enum ('head', 'lead', 'worker');
create type public.bot_status as enum ('working', 'waiting', 'resting', 'error');
create type public.bot_creator as enum ('user', 'bot');
create type public.task_status as enum ('backlog', 'doing', 'waiting_on_me', 'done', 'failed', 'cancelled');
create type public.task_source as enum ('web', 'telegram', 'slack', 'routine', 'bot');
create type public.run_status as enum ('queued', 'running', 'waiting', 'completed', 'failed');
create type public.inbox_kind as enum ('approval', 'question');
create type public.inbox_action as enum ('send', 'pay', 'publish', 'delete', 'merge', 'create_bot', 'create_department');
create type public.inbox_status as enum ('pending', 'approved', 'rejected', 'answered', 'expired');
create type public.channel as enum ('web', 'telegram', 'slack');
create type public.message_role as enum ('user', 'assistant', 'system');
create type public.connection_provider as enum ('composio_gmail', 'composio_calendar', 'github', 'telegram', 'slack');
create type public.connection_status as enum ('active', 'needs_reconnect');

-- ─── Helpers ────────────────────────────────────────────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ─── Tables ─────────────────────────────────────────────────────────────────────────────────────
create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (char_length(display_name) <= 80),
  timezone text not null default 'UTC' check (char_length(timezone) <= 64),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  icon text not null default '🏢' check (char_length(icon) between 1 and 16),
  daily_spend_cap_cents integer not null default 500 check (daily_spend_cap_cents between 0 and 100000),
  daily_task_cap integer not null default 50 check (daily_task_cap between 0 and 1000),
  recap_time time not null default '07:00',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index workspaces_owner_id_idx on public.workspaces (owner_id);

create table public.departments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 40),
  kind public.department_kind not null default 'custom',
  floor_index integer not null check (floor_index between 1 and 20),
  color text check (color ~ '^#[0-9a-fA-F]{6}$'),
  created_at timestamptz not null default now(),
  unique (workspace_id, floor_index),
  unique (id, workspace_id)
);
create index departments_workspace_id_idx on public.departments (workspace_id);

create table public.bots (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  department_id uuid not null,
  role public.bot_role not null default 'worker',
  name text not null check (char_length(btrim(name)) between 1 and 60),
  instructions text not null default '' check (char_length(instructions) <= 4000),
  tool_keys text[] not null default '{}' check (cardinality(tool_keys) <= 40),
  model text not null default 'claude-sonnet-5-5',
  avatar jsonb not null default '{"shape":"sphere","color":"#5c8fd6"}' check (jsonb_typeof(avatar) = 'object'),
  status public.bot_status not null default 'resting',
  status_detail text not null default 'Resting' check (char_length(status_detail) <= 280),
  last_active_at timestamptz,
  created_by public.bot_creator not null default 'user',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  foreign key (department_id, workspace_id) references public.departments (id, workspace_id) on delete cascade
);
create index bots_workspace_id_idx on public.bots (workspace_id);
create index bots_department_id_idx on public.bots (department_id);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  body text not null default '' check (char_length(body) <= 8000),
  status public.task_status not null default 'backlog',
  assignee_bot_id uuid,
  created_by_bot_id uuid,
  parent_task_id uuid,
  depth integer not null default 0 check (depth between 0 and 3),
  source public.task_source not null default 'web',
  result jsonb,
  position double precision not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  foreign key (assignee_bot_id, workspace_id) references public.bots (id, workspace_id) on delete no action,
  foreign key (created_by_bot_id, workspace_id) references public.bots (id, workspace_id) on delete no action,
  foreign key (parent_task_id, workspace_id) references public.tasks (id, workspace_id) on delete cascade
);
create index tasks_workspace_status_idx on public.tasks (workspace_id, status);
create index tasks_assignee_bot_id_idx on public.tasks (assignee_bot_id);
create index tasks_parent_task_id_idx on public.tasks (parent_task_id);

create table public.runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  task_id uuid,
  bot_id uuid,
  trigger_run_id text,
  status public.run_status not null default 'queued',
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cost_cents numeric(12, 4) not null default 0,
  started_at timestamptz,
  ended_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  unique (id, workspace_id),
  foreign key (task_id, workspace_id) references public.tasks (id, workspace_id) on delete no action,
  foreign key (bot_id, workspace_id) references public.bots (id, workspace_id) on delete no action
);
create index runs_workspace_created_idx on public.runs (workspace_id, created_at desc);
create index runs_task_id_idx on public.runs (task_id);
create index runs_bot_id_idx on public.runs (bot_id);

create table public.activity (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  bot_id uuid,
  task_id uuid,
  type text not null,
  summary text not null check (char_length(summary) <= 500),
  payload jsonb,
  created_at timestamptz not null default now(),
  foreign key (bot_id, workspace_id) references public.bots (id, workspace_id) on delete no action,
  foreign key (task_id, workspace_id) references public.tasks (id, workspace_id) on delete no action
);
create index activity_workspace_created_idx on public.activity (workspace_id, created_at desc);
create index activity_bot_id_idx on public.activity (bot_id);
create index activity_task_id_idx on public.activity (task_id);

create table public.inbox_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  bot_id uuid,
  task_id uuid,
  run_id uuid,
  kind public.inbox_kind not null,
  action public.inbox_action,
  tool_key text,
  title text not null check (char_length(title) <= 200),
  preview jsonb not null default '{}',
  input jsonb,
  edited_payload jsonb,
  answer text check (char_length(answer) <= 4000),
  status public.inbox_status not null default 'pending',
  waitpoint_token_id text,
  decided_via public.channel,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (bot_id, workspace_id) references public.bots (id, workspace_id) on delete no action,
  foreign key (task_id, workspace_id) references public.tasks (id, workspace_id) on delete no action,
  foreign key (run_id, workspace_id) references public.runs (id, workspace_id) on delete no action
);
create index inbox_items_workspace_status_idx on public.inbox_items (workspace_id, status);
create index inbox_items_bot_id_idx on public.inbox_items (bot_id);
create index inbox_items_task_id_idx on public.inbox_items (task_id);
create index inbox_items_run_id_idx on public.inbox_items (run_id);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  bot_id uuid not null,
  role public.message_role not null,
  parts jsonb not null default '[]',
  channel public.channel not null default 'web',
  created_at timestamptz not null default now(),
  foreign key (bot_id, workspace_id) references public.bots (id, workspace_id) on delete cascade
);
create index messages_bot_created_idx on public.messages (bot_id, created_at);
create index messages_workspace_id_idx on public.messages (workspace_id);

create table public.bot_notes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  bot_id uuid not null unique,
  content text not null default '' check (char_length(content) <= 20000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (bot_id, workspace_id) references public.bots (id, workspace_id) on delete cascade
);
create index bot_notes_workspace_id_idx on public.bot_notes (workspace_id);

create table public.routines (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  bot_id uuid not null,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  cron text not null check (char_length(cron) <= 100),
  timezone text not null default 'UTC',
  prompt text not null default '' check (char_length(prompt) <= 4000),
  enabled boolean not null default true,
  next_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (bot_id, workspace_id) references public.bots (id, workspace_id) on delete cascade
);
create index routines_workspace_id_idx on public.routines (workspace_id);
create index routines_bot_id_idx on public.routines (bot_id);
create index routines_due_idx on public.routines (next_run_at) where enabled;

create table public.watches (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  bot_id uuid not null,
  url text not null check (url ~* '^https?://' and char_length(url) <= 2048),
  target text not null default '' check (char_length(target) <= 500),
  last_value numeric,
  threshold numeric,
  last_checked_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (bot_id, workspace_id) references public.bots (id, workspace_id) on delete cascade
);
create index watches_workspace_id_idx on public.watches (workspace_id);
create index watches_bot_id_idx on public.watches (bot_id);

create table public.recaps (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  for_date date not null,
  content jsonb not null,
  created_at timestamptz not null default now(),
  unique (workspace_id, for_date)
);

create table public.connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  provider public.connection_provider not null,
  external_id text,
  meta jsonb not null default '{}',
  vault_secret_id uuid,
  status public.connection_status not null default 'active',
  created_at timestamptz not null default now(),
  unique (workspace_id, provider)
);

create table public.telegram_link_codes (
  code text primary key check (char_length(code) between 16 and 64),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  expires_at timestamptz not null default now() + interval '15 minutes',
  created_at timestamptz not null default now()
);
create index telegram_link_codes_user_id_idx on public.telegram_link_codes (user_id);

-- ─── PostgreSQL 14 compatible nullable references ─────────────────────────────────────────────
-- PostgreSQL 15 added `ON DELETE SET NULL (column)`. Keep the composite foreign keys (and their
-- workspace-integrity guarantees), but clear only the nullable reference before the delete check.
create or replace function public.clear_reference_on_delete()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  execute format(
    'update public.%I set %I = null where %I = $1',
    tg_argv[0],
    tg_argv[1],
    tg_argv[1]
  ) using old.id;
  return old;
end;
$$;

create trigger bots_clear_task_assignee before delete on public.bots
  for each row execute function public.clear_reference_on_delete('tasks', 'assignee_bot_id');
create trigger bots_clear_task_creator before delete on public.bots
  for each row execute function public.clear_reference_on_delete('tasks', 'created_by_bot_id');
create trigger bots_clear_run before delete on public.bots
  for each row execute function public.clear_reference_on_delete('runs', 'bot_id');
create trigger bots_clear_activity before delete on public.bots
  for each row execute function public.clear_reference_on_delete('activity', 'bot_id');
create trigger bots_clear_inbox before delete on public.bots
  for each row execute function public.clear_reference_on_delete('inbox_items', 'bot_id');

create trigger tasks_clear_run before delete on public.tasks
  for each row execute function public.clear_reference_on_delete('runs', 'task_id');
create trigger tasks_clear_activity before delete on public.tasks
  for each row execute function public.clear_reference_on_delete('activity', 'task_id');
create trigger tasks_clear_inbox before delete on public.tasks
  for each row execute function public.clear_reference_on_delete('inbox_items', 'task_id');

create trigger runs_clear_inbox before delete on public.runs
  for each row execute function public.clear_reference_on_delete('inbox_items', 'run_id');

-- ─── updated_at triggers ────────────────────────────────────────────────────────────────────────
create trigger profiles_updated_at before update on public.profiles for each row execute function public.set_updated_at();
create trigger workspaces_updated_at before update on public.workspaces for each row execute function public.set_updated_at();
create trigger bots_updated_at before update on public.bots for each row execute function public.set_updated_at();
create trigger tasks_updated_at before update on public.tasks for each row execute function public.set_updated_at();
create trigger bot_notes_updated_at before update on public.bot_notes for each row execute function public.set_updated_at();
create trigger routines_updated_at before update on public.routines for each row execute function public.set_updated_at();

-- Cap workspaces per owner (platform pays for usage; plan risk R2).
create or replace function public.enforce_workspace_limit()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if (select count(*) from public.workspaces w where w.owner_id = new.owner_id) >= 10 then
    raise exception 'Workspace limit reached (10 per account)' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger workspaces_limit before insert on public.workspaces for each row execute function public.enforce_workspace_limit();

-- ─── Privileges (Data API) ──────────────────────────────────────────────────────────────────────
-- Explicit grants: anon gets nothing; authenticated gets only what its policies allow.
revoke all on
  public.profiles, public.workspaces, public.departments, public.bots, public.tasks, public.runs,
  public.activity, public.inbox_items, public.messages, public.bot_notes, public.routines,
  public.watches, public.recaps, public.connections, public.telegram_link_codes
from anon, authenticated;

grant select, insert, update on public.profiles to authenticated;
grant select, insert, update, delete on
  public.workspaces, public.departments, public.bots, public.tasks, public.messages,
  public.bot_notes, public.routines, public.watches
to authenticated;
grant select on public.runs, public.activity, public.inbox_items, public.recaps, public.connections to authenticated;
grant select, insert, delete on public.telegram_link_codes to authenticated;

grant all on
  public.profiles, public.workspaces, public.departments, public.bots, public.tasks, public.runs,
  public.activity, public.inbox_items, public.messages, public.bot_notes, public.routines,
  public.watches, public.recaps, public.connections, public.telegram_link_codes
to service_role;

-- ─── Row Level Security ─────────────────────────────────────────────────────────────────────────
alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.departments enable row level security;
alter table public.bots enable row level security;
alter table public.tasks enable row level security;
alter table public.runs enable row level security;
alter table public.activity enable row level security;
alter table public.inbox_items enable row level security;
alter table public.messages enable row level security;
alter table public.bot_notes enable row level security;
alter table public.routines enable row level security;
alter table public.watches enable row level security;
alter table public.recaps enable row level security;
alter table public.connections enable row level security;
alter table public.telegram_link_codes enable row level security;

-- profiles: each user manages only their own row
create policy "profiles: read own" on public.profiles for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "profiles: insert own" on public.profiles for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "profiles: update own" on public.profiles for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- workspaces: owner only
create policy "workspaces: read own" on public.workspaces for select to authenticated
  using ((select auth.uid()) = owner_id);
create policy "workspaces: create own" on public.workspaces for insert to authenticated
  with check ((select auth.uid()) = owner_id);
create policy "workspaces: update own" on public.workspaces for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);
create policy "workspaces: delete own" on public.workspaces for delete to authenticated
  using ((select auth.uid()) = owner_id);

-- Workspace-scoped tables the user edits (through server actions): full CRUD for the owner.
do $$
declare
  t text;
  owns text := 'exists (select 1 from public.workspaces w where w.id = workspace_id and w.owner_id = (select auth.uid()))';
begin
  foreach t in array array['departments', 'bots', 'tasks', 'messages', 'bot_notes', 'routines', 'watches'] loop
    execute format('create policy "%1$s: owner read" on public.%1$I for select to authenticated using (%2$s)', t, owns);
    execute format('create policy "%1$s: owner insert" on public.%1$I for insert to authenticated with check (%2$s)', t, owns);
    execute format('create policy "%1$s: owner update" on public.%1$I for update to authenticated using (%2$s) with check (%2$s)', t, owns);
    execute format('create policy "%1$s: owner delete" on public.%1$I for delete to authenticated using (%2$s)', t, owns);
  end loop;

  -- Runtime-written tables: owner can read; writes come from the agent runtime (secret key).
  foreach t in array array['runs', 'activity', 'inbox_items', 'recaps', 'connections'] loop
    execute format('create policy "%1$s: owner read" on public.%1$I for select to authenticated using (%2$s)', t, owns);
  end loop;
end;
$$;

-- telegram_link_codes: per user
create policy "telegram_link_codes: read own" on public.telegram_link_codes for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "telegram_link_codes: create own" on public.telegram_link_codes for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "telegram_link_codes: delete own" on public.telegram_link_codes for delete to authenticated
  using ((select auth.uid()) = user_id);

-- ─── create_workspace: workspace + starter building in one transaction ──────────────────────────
-- SECURITY INVOKER: every insert below goes through the RLS policies above as the caller.
create or replace function public.create_workspace(p_name text, p_icon text default '🏢')
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_ws uuid;
  v_head uuid;
  v_assistant uuid;
  v_research uuid;
  v_engineering uuid;
  v_base text[] := array['notes.read', 'notes.write', 'ask_user', 'task.update', 'task.complete'];
begin
  if v_uid is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;

  insert into public.workspaces (owner_id, name, icon)
  values (v_uid, btrim(p_name), coalesce(nullif(btrim(p_icon), ''), '🏢'))
  returning id into v_ws;

  insert into public.departments (workspace_id, name, kind, floor_index) values (v_ws, '总控办公室', 'head', 4) returning id into v_head;
  insert into public.departments (workspace_id, name, kind, floor_index) values (v_ws, '助理', 'assistant', 3) returning id into v_assistant;
  insert into public.departments (workspace_id, name, kind, floor_index) values (v_ws, '研究', 'research', 2) returning id into v_research;
  insert into public.departments (workspace_id, name, kind, floor_index) values (v_ws, '工程', 'engineering', 1) returning id into v_engineering;

  insert into public.bots (workspace_id, department_id, role, name, instructions, tool_keys, avatar) values
    (v_ws, v_head, 'head', '幕僚长',
      '规划用户需求，拆成任务并交给合适的楼层。团队缺少能力时，提议创建新的 Bot 或部门。',
      v_base || array['assign_task', 'propose_bot', 'propose_department'],
      '{"shape":"sphere","color":"#5c8fd6"}'),
    (v_ws, v_assistant, 'lead', '收件箱助手',
      '整理收件箱、起草回复并管理日程。发送任何内容前都必须先征求确认。',
      v_base || array['assign_task', 'gmail.search', 'gmail.read', 'gmail.draft', 'gmail.send', 'calendar.list', 'calendar.create_event'],
      '{"shape":"sphere","color":"#e3a857"}'),
    (v_ws, v_assistant, 'worker', '每日简报',
      '根据邮件和日程生成简短的每日早报。',
      v_base || array['gmail.search', 'gmail.read', 'calendar.list'],
      '{"shape":"cube","color":"#7fb5a0"}'),
    (v_ws, v_research, 'lead', '研究员',
      '负责研究需求：搜索网页、读取页面，并把较大的问题拆分给研究楼层。',
      v_base || array['assign_task', 'web.search', 'browser.extract'],
      '{"shape":"diamond","color":"#8e7cc3"}'),
    (v_ws, v_research, 'worker', '价格监控',
      '监控商品价格，并在低于阈值时报告。',
      v_base || array['browser.extract', 'watch.add', 'watch.check'],
      '{"shape":"capsule","color":"#d9775f"}'),
    (v_ws, v_engineering, 'lead', '技术主管',
      '拆分工程任务，评审执行 Bot 的 Pull Request，并在合并前征求确认。',
      v_base || array['assign_task', 'repo.list', 'code.run_task', 'pr.open_draft', 'pr.merge'],
      '{"shape":"cube","color":"#3b3a45"}'),
    (v_ws, v_engineering, 'worker', '工程师',
      '在沙箱中完成指定任务并创建草稿 Pull Request。',
      v_base || array['code.run_task', 'pr.open_draft'],
      '{"shape":"capsule","color":"#5c8fd6"}');

  return v_ws;
end;
$$;

revoke execute on function public.create_workspace(text, text) from public, anon;
grant execute on function public.create_workspace(text, text) to authenticated;
revoke execute on function public.enforce_workspace_limit() from public, anon, authenticated;
revoke execute on function public.set_updated_at() from public, anon, authenticated;

-- ─── Realtime: the office updates live (RLS applies to realtime too) ────────────────────────────
alter publication supabase_realtime add table public.bots, public.tasks, public.activity, public.inbox_items;
