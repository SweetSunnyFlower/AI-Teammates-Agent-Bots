-- Chat threads: one continuous thread per bot.
--
-- * "New chat" inserts a divider row (kind = 'divider'). The bot only remembers messages after
--   the latest divider; older messages stay visible above it.
-- * Messages are never edited or deleted (the history is permanent).
-- * `ui_id` is the AI SDK message id so a stored thread can be reloaded into the chat UI as-is.

alter table public.messages
  add column kind text not null default 'message' check (kind in ('message', 'divider')),
  add column ui_id text check (char_length(ui_id) <= 64);

alter table public.messages
  add constraint messages_parts_is_array check (jsonb_typeof(parts) = 'array'),
  add constraint messages_parts_size check (pg_column_size(parts) <= 256000),
  add constraint messages_divider_is_system check (kind <> 'divider' or role = 'system');

create unique index messages_bot_ui_id_unique on public.messages (bot_id, ui_id) where ui_id is not null;
create index messages_bot_divider_idx on public.messages (bot_id, created_at desc) where kind = 'divider';
create index messages_bot_created_desc_idx on public.messages (bot_id, created_at desc);

-- Permanent history: no edits, no deletes (bots/workspaces deleting still cascades as the owner).
drop policy "messages: owner update" on public.messages;
drop policy "messages: owner delete" on public.messages;
revoke update, delete on public.messages from authenticated;
