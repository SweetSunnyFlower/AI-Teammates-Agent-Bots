-- Self-hosted runtime additions: Better Auth, queue-backed runs and model choices.

create table if not exists public."user" (
  id uuid primary key,
  name text not null,
  email text not null unique,
  email_verified boolean not null default false,
  image text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public."session" (
  id uuid primary key,
  expires_at timestamptz not null,
  token text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ip_address text,
  user_agent text,
  user_id uuid not null references public."user"(id) on delete cascade
);
create index if not exists session_user_id_idx on public."session" (user_id);

create table if not exists public."account" (
  id uuid primary key,
  account_id text not null,
  provider_id text not null,
  user_id uuid not null references public."user"(id) on delete cascade,
  access_token text,
  refresh_token text,
  id_token text,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  scope text,
  password text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists account_user_id_idx on public."account" (user_id);

create table if not exists public."verification" (
  id uuid primary key,
  identifier text not null,
  value text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists verification_identifier_idx on public."verification" (identifier);

alter table public."user" alter column id set default gen_random_uuid();
alter table public."session" alter column id set default gen_random_uuid();
alter table public."account" alter column id set default gen_random_uuid();
alter table public."verification" alter column id set default gen_random_uuid();

create or replace function public.sync_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    delete from auth.users where id = old.id;
    return old;
  end if;

  insert into auth.users (id, email, created_at, updated_at)
  values (new.id, new.email, new.created_at, new.updated_at)
  on conflict (id) do update
    set email = excluded.email,
        updated_at = excluded.updated_at;
  return new;
end;
$$;

drop trigger if exists sync_auth_user_insert on public."user";
create trigger sync_auth_user_insert
  after insert or update on public."user"
  for each row execute function public.sync_auth_user();

drop trigger if exists sync_auth_user_delete on public."user";
create trigger sync_auth_user_delete
  after delete on public."user"
  for each row execute function public.sync_auth_user();

alter table public.bots drop constraint if exists bots_model_known;
alter table public.bots
  add constraint bots_model_known check (model in ('deepseek-chat', 'deepseek-reasoner'));
update public.bots set model = 'deepseek-chat' where model not in ('deepseek-chat', 'deepseek-reasoner');
alter table public.bots alter column model set default 'deepseek-chat';

alter table public.runs
  add column if not exists agent_state jsonb;
alter table public.runs rename column trigger_run_id to job_id;
create index if not exists runs_job_id_idx on public.runs (job_id) where job_id is not null;

alter table public.inbox_items
  add column if not exists resume_job_id text,
  add column if not exists resume_state jsonb;
create index if not exists inbox_resume_job_idx on public.inbox_items (resume_job_id) where resume_job_id is not null;

alter table public.code_runs rename column trigger_run_id to job_id;
