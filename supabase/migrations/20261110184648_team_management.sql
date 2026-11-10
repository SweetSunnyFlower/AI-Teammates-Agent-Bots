-- Team management: departments (floors) and bots can be created, edited, reordered and deleted.
--
-- Rules enforced in the database (not just the UI):
--   * Exactly one Head bot per workspace. It is created with the workspace, can't be deleted,
--     demoted or duplicated, and always sits on the Head office floor.
--   * The Head office floor can't be deleted and is always the top floor.
--   * At most one Lead per department; the Head office floor has the Head instead of a Lead.
-- Multi-step changes go through SECURITY INVOKER functions so they run in one transaction with
-- the caller's RLS policies applied.

-- ─── Departments: description + reorderable floors ─────────────────────────────────────────────
alter table public.departments
  add column description text not null default '' check (char_length(description) <= 280);

-- Deferred so floors can swap positions inside one transaction.
alter table public.departments drop constraint departments_workspace_id_floor_index_key;
alter table public.departments
  add constraint departments_workspace_floor_unique unique (workspace_id, floor_index) deferrable initially deferred;

create unique index departments_one_head_per_workspace on public.departments (workspace_id) where kind = 'head';
create unique index bots_one_head_per_workspace on public.bots (workspace_id) where role = 'head';
create unique index bots_one_lead_per_department on public.bots (department_id) where role = 'lead';

alter table public.bots
  add constraint bots_avatar_shape check (avatar ->> 'shape' in ('sphere', 'cube', 'capsule', 'cylinder', 'cone', 'diamond')),
  add constraint bots_avatar_color check ((avatar ->> 'color') ~ '^#[0-9a-fA-F]{6}$'),
  add constraint bots_model_known check (model in ('claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-opus-5-5'));

-- ─── Guards ─────────────────────────────────────────────────────────────────────────────────────
-- The workspace-exists check lets whole-workspace deletes cascade normally.
create or replace function public.guard_head_bot()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.role = 'head' and exists (select 1 from public.workspaces w where w.id = old.workspace_id) then
      raise exception 'The Head bot can''t be deleted' using errcode = 'check_violation';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' and (old.role = 'head') <> (new.role = 'head') then
    raise exception 'The Head bot''s role can''t change' using errcode = 'check_violation';
  end if;

  if new.role = 'head' and not exists (
    select 1 from public.departments d where d.id = new.department_id and d.kind = 'head'
  ) then
    raise exception 'The Head bot must sit on the Head office floor' using errcode = 'check_violation';
  end if;

  if new.role = 'lead' and exists (
    select 1 from public.departments d where d.id = new.department_id and d.kind = 'head'
  ) then
    raise exception 'The Head office has the Head bot instead of a Lead' using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger bots_guard_head
  before insert or update or delete on public.bots
  for each row execute function public.guard_head_bot();

create or replace function public.guard_head_department()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.kind = 'head' and exists (select 1 from public.workspaces w where w.id = old.workspace_id) then
      raise exception 'The Head office floor can''t be deleted' using errcode = 'check_violation';
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' and (old.kind = 'head') <> (new.kind = 'head') then
    raise exception 'The Head office floor keeps its type' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger departments_guard_head
  before update or delete on public.departments
  for each row execute function public.guard_head_department();

-- Checked at commit so multi-row moves can pass through intermediate states.
create or replace function public.check_head_on_top()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.departments h
    join public.departments d on d.workspace_id = h.workspace_id and d.id <> h.id
    where h.workspace_id = new.workspace_id and h.kind = 'head' and d.floor_index > h.floor_index
  ) then
    raise exception 'The Head office must stay on the top floor' using errcode = 'check_violation';
  end if;
  return null;
end;
$$;

create constraint trigger departments_head_on_top
  after insert or update on public.departments
  deferrable initially deferred
  for each row execute function public.check_head_on_top();

-- ─── create_department: new floor goes directly under the Head office ───────────────────────────
create or replace function public.create_department(
  p_workspace_id uuid,
  p_name text,
  p_color text default null,
  p_description text default '',
  p_kind public.department_kind default 'custom'
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_head_floor integer;
  v_id uuid;
begin
  if p_kind = 'head' then
    raise exception 'A workspace has exactly one Head office' using errcode = 'check_violation';
  end if;

  select floor_index into v_head_floor
  from public.departments
  where workspace_id = p_workspace_id and kind = 'head'
  for update;
  if v_head_floor is null then
    raise exception 'Workspace not found' using errcode = 'P0002';
  end if;

  update public.departments set floor_index = floor_index + 1
  where workspace_id = p_workspace_id and kind = 'head';

  insert into public.departments (workspace_id, name, kind, floor_index, color, description)
  values (p_workspace_id, btrim(p_name), p_kind, v_head_floor, p_color, coalesce(p_description, ''))
  returning id into v_id;

  return v_id;
end;
$$;

-- ─── reorder_departments: ids bottom → top for every non-head floor; Head stays on top ─────────
create or replace function public.reorder_departments(p_workspace_id uuid, p_bottom_up uuid[])
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_expected integer;
begin
  select count(*) into v_expected
  from public.departments
  where workspace_id = p_workspace_id and kind <> 'head';

  if cardinality(p_bottom_up) <> v_expected
     or (select count(distinct x) from unnest(p_bottom_up) as x) <> v_expected
     or exists (
       select 1 from unnest(p_bottom_up) as x
       where not exists (
         select 1 from public.departments d
         where d.id = x and d.workspace_id = p_workspace_id and d.kind <> 'head'
       )
     ) then
    raise exception 'The new order must list every floor except the Head office exactly once' using errcode = 'check_violation';
  end if;

  update public.departments d
  set floor_index = o.ord
  from unnest(p_bottom_up) with ordinality as o(id, ord)
  where d.id = o.id and d.workspace_id = p_workspace_id;

  update public.departments
  set floor_index = v_expected + 1
  where workspace_id = p_workspace_id and kind = 'head';
end;
$$;

-- ─── delete_department: move its bots elsewhere (or delete them), then close the gap ────────────
create or replace function public.delete_department(p_department_id uuid, p_move_bots_to uuid default null)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_dept public.departments%rowtype;
  v_target public.departments%rowtype;
begin
  select * into v_dept from public.departments where id = p_department_id for update;
  if not found then
    raise exception 'Floor not found' using errcode = 'P0002';
  end if;
  if v_dept.kind = 'head' then
    raise exception 'The Head office floor can''t be deleted' using errcode = 'check_violation';
  end if;

  if p_move_bots_to is not null then
    select * into v_target from public.departments where id = p_move_bots_to;
    if not found or v_target.workspace_id <> v_dept.workspace_id or v_target.id = v_dept.id then
      raise exception 'Pick another floor in this workspace to move the bots to' using errcode = 'check_violation';
    end if;
    -- A floor keeps one Lead: the moving Lead becomes a worker if the target already has one
    -- (or is the Head office).
    if v_target.kind = 'head' or exists (
      select 1 from public.bots where department_id = v_target.id and role = 'lead'
    ) then
      update public.bots set role = 'worker' where department_id = v_dept.id and role = 'lead';
    end if;
    update public.bots set department_id = v_target.id where department_id = v_dept.id;
  else
    delete from public.bots where department_id = v_dept.id;
  end if;

  delete from public.departments where id = v_dept.id;

  -- Renumber floors 1..n (bottom up) so there are no gaps; the Head office stays on top.
  update public.departments d
  set floor_index = r.rn
  from (
    select id, row_number() over (order by (kind = 'head'), floor_index) as rn
    from public.departments
    where workspace_id = v_dept.workspace_id
  ) r
  where d.id = r.id and d.floor_index <> r.rn;
end;
$$;

-- ─── save_bot: create or update; picking Lead replaces the floor's current Lead ────────────────
create or replace function public.save_bot(
  p_workspace_id uuid,
  p_bot_id uuid,
  p_department_id uuid,
  p_role public.bot_role,
  p_name text,
  p_instructions text,
  p_tool_keys text[],
  p_avatar jsonb,
  p_model text
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
    insert into public.bots (workspace_id, department_id, role, name, instructions, tool_keys, avatar, model, created_by)
    values (p_workspace_id, v_department, v_role, btrim(p_name), coalesce(p_instructions, ''), coalesce(p_tool_keys, '{}'), p_avatar, p_model, 'user')
    returning id into v_id;
  else
    update public.bots
    set department_id = v_department,
        role = v_role,
        name = btrim(p_name),
        instructions = coalesce(p_instructions, ''),
        tool_keys = coalesce(p_tool_keys, '{}'),
        avatar = p_avatar,
        model = p_model
    where id = p_bot_id
    returning id into v_id;
  end if;

  return v_id;
end;
$$;

-- ─── Privileges ────────────────────────────────────────────────────────────────────────────────
revoke execute on function public.create_department(uuid, text, text, text, public.department_kind) from public, anon;
revoke execute on function public.reorder_departments(uuid, uuid[]) from public, anon;
revoke execute on function public.delete_department(uuid, uuid) from public, anon;
revoke execute on function public.save_bot(uuid, uuid, uuid, public.bot_role, text, text, text[], jsonb, text) from public, anon;
grant execute on function public.create_department(uuid, text, text, text, public.department_kind) to authenticated;
grant execute on function public.reorder_departments(uuid, uuid[]) to authenticated;
grant execute on function public.delete_department(uuid, uuid) to authenticated;
grant execute on function public.save_bot(uuid, uuid, uuid, public.bot_role, text, text, text[], jsonb, text) to authenticated;

revoke execute on function public.guard_head_bot() from public, anon, authenticated;
revoke execute on function public.guard_head_department() from public, anon, authenticated;
revoke execute on function public.check_head_on_top() from public, anon, authenticated;
