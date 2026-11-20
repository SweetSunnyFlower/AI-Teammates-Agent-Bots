-- Engineering code runs (D20): an Engineering bot's coding session in an Upstash Box sandbox,
-- ending in a draft pull request. Written only by the Trigger.dev runtime (service role); the
-- workspace owner can read them. Coding has its own daily spend cap so it can't use up the
-- budget of the other bots.

alter table public.workspaces
  add column daily_engineering_cap_cents integer not null default 1000
    check (daily_engineering_cap_cents between 0 and 100000);

create type public.code_run_status as enum ('running', 'succeeded', 'no_changes', 'failed');

create table public.code_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  task_id uuid references public.tasks (id) on delete set null,
  bot_id uuid references public.bots (id) on delete set null,
  trigger_run_id text,
  repo text not null check (char_length(repo) between 3 and 201),
  base_ref text,
  branch text,
  issue_number integer check (issue_number > 0),
  pr_number integer check (pr_number > 0),
  pr_url text,
  instructions text not null check (char_length(instructions) <= 20000),
  status public.code_run_status not null default 'running',
  tests text check (tests in ('passed', 'failed', 'none')),
  test_command text,
  test_output text check (char_length(test_output) <= 8000),
  summary text check (char_length(summary) <= 8000),
  files_changed integer,
  additions integer,
  deletions integer,
  steps integer not null default 0,
  cost_cents numeric(12, 4) not null default 0,
  error text check (char_length(error) <= 2000),
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create index code_runs_workspace_created_idx on public.code_runs (workspace_id, created_at desc);
create index code_runs_task_idx on public.code_runs (task_id) where task_id is not null;
create index code_runs_bot_idx on public.code_runs (bot_id) where bot_id is not null;

alter table public.code_runs enable row level security;

revoke all on public.code_runs from anon, authenticated;
grant select on public.code_runs to authenticated;
grant all on public.code_runs to service_role;

create policy "code_runs: owner read" on public.code_runs for select to authenticated
  using (exists (select 1 from public.workspaces w where w.id = workspace_id and w.owner_id = (select auth.uid())));

-- Boards show a run's pull request and test result as it happens.
alter publication supabase_realtime add table public.code_runs;
