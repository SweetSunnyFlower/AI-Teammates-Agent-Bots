-- Lightweight server push without Supabase Realtime.
-- Database changes publish a small metadata payload; the Next.js SSE endpoint fans it out.

create or replace function public.notify_dotty_change()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  row_data jsonb;
  payload jsonb;
begin
  row_data := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  payload := jsonb_build_object(
    'table', tg_table_name,
    'op', lower(tg_op),
    'workspaceId', row_data ->> 'workspace_id'
  );

  if row_data ? 'bot_id' then
    payload := payload || jsonb_build_object('botId', row_data ->> 'bot_id');
  end if;
  if row_data ? 'task_id' then
    payload := payload || jsonb_build_object('taskId', row_data ->> 'task_id');
  end if;

  perform pg_notify('dotty_events', payload::text);
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'departments', 'bots', 'tasks', 'runs', 'activity', 'inbox_items',
    'messages', 'routines', 'code_runs'
  ] loop
    execute format(
      'drop trigger if exists %I on public.%I',
      table_name || '_dotty_notify',
      table_name
    );
    execute format(
      'create trigger %I after insert or update or delete on public.%I for each row execute function public.notify_dotty_change()',
      table_name || '_dotty_notify',
      table_name
    );
  end loop;
end;
$$;
