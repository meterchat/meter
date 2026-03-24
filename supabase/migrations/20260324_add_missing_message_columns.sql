-- Add columns that exist in the client ChatMessage type but were missing from the DB.
-- These fields were previously in-memory only and lost on page refresh.

alter table chat_messages add column if not exists pinned boolean default false;
alter table chat_messages add column if not exists decision_id text;
alter table chat_messages add column if not exists hidden boolean default false;
alter table chat_messages add column if not exists clarifying_questions jsonb;
