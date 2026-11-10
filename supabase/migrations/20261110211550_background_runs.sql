-- Background runs (Trigger.dev) + live updates.
--
-- * Chat threads update live too (run results are posted into the bot's thread).
-- * runs.steps counts model steps for the activity feed and debugging.
-- * One active run per task: a partial unique index stops two workers running the same task.

alter publication supabase_realtime add table public.messages;

alter table public.runs
  add column steps integer not null default 0;

create unique index runs_one_active_per_task
  on public.runs (task_id)
  where status in ('queued', 'running', 'waiting');

create index runs_workspace_started_idx on public.runs (workspace_id, started_at desc);
