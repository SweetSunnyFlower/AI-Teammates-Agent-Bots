-- Where a code run's pull request stands (D20, Phase 10): set to `open` when Dotty opens it,
-- `merged` when the approved merge goes through, and kept in step with GitHub by the webhook
-- (merged or closed there, reopened).
alter table public.code_runs
  add column pr_state text check (pr_state in ('open', 'merged', 'closed'));

update public.code_runs set pr_state = 'open' where pr_number is not null and status = 'succeeded';
