-- The Head bot can propose a routine; it becomes an approval on Waiting on me and the routine is
-- only created when the user approves it.
alter type public.inbox_action add value if not exists 'create_routine';
