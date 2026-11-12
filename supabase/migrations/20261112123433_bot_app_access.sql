-- Per-bot app access (Composio toolkits), chosen in the bot dialog.
--   app_keys = '{*}'             → every app connected to the workspace, now and later
--   app_keys = '{gmail,notion}'  → only these toolkit slugs
--   app_keys = '{}'              → no apps
-- Defaults: the Head none, Leads and workers all. A bot can only *ask* for access (a Waiting on
-- me card); only the user grants it.

alter table public.bots
  add column app_keys text[] not null default '{*}'
  check (cardinality(app_keys) <= 50);

update public.bots set app_keys = '{}' where role = 'head';

-- New Head bots (created with the workspace) start without apps.
create or replace function public.default_head_app_keys()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.role = 'head' then
    new.app_keys := '{}';
  end if;
  return new;
end;
$$;

create trigger bots_default_head_app_keys
  before insert on public.bots
  for each row execute function public.default_head_app_keys();

-- "Waiting on me" card kind: a bot asks for an app it doesn't have.
alter type public.inbox_kind add value if not exists 'access';

-- ─── save_bot: same as before, plus the app choice (null = keep / column default) ─────────────
drop function public.save_bot(uuid, uuid, uuid, public.bot_role, text, text, text[], jsonb, text);

create function public.save_bot(
  p_workspace_id uuid,
  p_bot_id uuid,
  p_department_id uuid,
  p_role public.bot_role,
  p_name text,
  p_instructions text,
  p_tool_keys text[],
  p_avatar jsonb,
  p_model text,
  p_app_keys text[] default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_existing public.bots%rowtype;
  v_department uuid := p_department_id;
  v_role public.bot_role := p_role;
  v_id uuid;
begin
  if p_bot_id is not null then
    select * into v_existing from public.bots where id = p_bot_id and workspace_id = p_workspace_id for update;
    if not found then
      raise exception 'Bot not found' using errcode = 'P0002';
    end if;
    -- The Head keeps its role and floor no matter what the form sent.
    if v_existing.role = 'head' then
      v_department := v_existing.department_id;
      v_role := 'head';
    end if;
  end if;

  if v_role = 'head' and (p_bot_id is null or v_existing.role <> 'head') then
    raise exception 'A workspace has exactly one Head bot' using errcode = 'check_violation';
  end if;

  if v_role = 'lead' then
    update public.bots
    set role = 'worker'
    where department_id = v_department and role = 'lead' and id is distinct from p_bot_id;
  end if;

  if p_bot_id is null then
    insert into public.bots (workspace_id, department_id, role, name, instructions, tool_keys, avatar, model, created_by, app_keys)
    values (p_workspace_id, v_department, v_role, btrim(p_name), coalesce(p_instructions, ''), coalesce(p_tool_keys, '{}'), p_avatar, p_model, 'user', coalesce(p_app_keys, '{*}'))
    returning id into v_id;
  else
    update public.bots
    set department_id = v_department,
        role = v_role,
        name = btrim(p_name),
        instructions = coalesce(p_instructions, ''),
        tool_keys = coalesce(p_tool_keys, '{}'),
        avatar = p_avatar,
        model = p_model,
        app_keys = coalesce(p_app_keys, app_keys)
    where id = p_bot_id
    returning id into v_id;
  end if;

  return v_id;
end;
$$;

revoke execute on function public.save_bot(uuid, uuid, uuid, public.bot_role, text, text, text[], jsonb, text, text[]) from public, anon;
grant execute on function public.save_bot(uuid, uuid, uuid, public.bot_role, text, text, text[], jsonb, text, text[]) to authenticated;
