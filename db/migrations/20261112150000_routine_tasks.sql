-- Routines (Phase 7): each routine run is a task linked back to its routine, so the dispatcher can
-- skip a tick while the previous run is still going, and the UI can show the last run.
alter table public.routines add constraint routines_id_workspace_unique unique (id, workspace_id);

alter table public.tasks add column routine_id uuid;
alter table public.tasks
  add constraint tasks_routine_fk foreign key (routine_id, workspace_id)
  references public.routines (id, workspace_id) on delete no action;
create index tasks_routine_id_idx on public.tasks (routine_id) where routine_id is not null;

create trigger routines_clear_tasks before delete on public.routines
  for each row execute function public.clear_reference_on_delete('tasks', 'routine_id');

-- Disabled routines never sit in the due index.
update public.routines set next_run_at = null where not enabled;
