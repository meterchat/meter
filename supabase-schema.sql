-- Meter: Full database schema
-- Run this in the Supabase SQL editor (Dashboard > SQL Editor)

-- =============================================
-- USERS & AUTH
-- =============================================

-- Users table (passkey-based anonymous accounts)
create table if not exists meter_users (
  id text primary key,
  handle text unique,                   -- short alphanumeric user ID (e.g. "ab41ki"), public-facing
  email text unique,                    -- optional, auto-generated as {handle}@meter.chat for Stripe
  account_type text not null default 'standard',  -- 'standard' | 'superadmin'
  markup_multiplier numeric not null default 2,   -- per-account pricing multiplier (2 = 2x consumer markup)
  stripe_customer_id text,
  card_last4 text,
  card_brand text,
  gmail_connected boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Passkey credentials (WebAuthn)
create table if not exists passkey_credentials (
  credential_id text primary key,
  user_id text not null references meter_users(id) on delete cascade,
  public_key text not null,
  counter bigint not null default 0,
  device_type text,
  backed_up boolean default false,
  transports jsonb,
  created_at timestamptz default now()
);

-- Auth challenges (temporary, for WebAuthn ceremony)
create table if not exists auth_challenges (
  id text primary key,
  email text not null,
  challenge text not null,
  type text not null check (type in ('register', 'login')),
  expires_at timestamptz not null,
  created_at timestamptz default now()
);

-- OAuth / API key tokens (workspace-scoped)
create table if not exists oauth_tokens (
  id text primary key,
  user_id text not null references meter_users(id) on delete cascade,
  provider text not null,
  workspace_id text not null,
  access_token text not null,
  refresh_token text,
  expires_at timestamptz,
  scopes text,
  metadata jsonb,
  updated_at timestamptz default now(),
  unique(user_id, provider, workspace_id)
);

-- =============================================
-- CHAT & SESSIONS
-- =============================================

-- Chat sessions (one per workspace, or one per track when forked)
create table if not exists chat_sessions (
  id text primary key,
  user_id text not null,
  project_name text not null,           -- legacy alias; use workspace_name going forward
  workspace_name text,                  -- canonical workspace/track display name
  is_subtrack boolean default false,    -- true for forked track sessions (not standalone workspaces)
  parent_session_id text,               -- points to parent workspace session when is_subtrack=true
  fork_message_id text,                 -- last shared message ID before fork divergence
  total_cost numeric default 0,
  today_cost numeric default 0,
  today_tokens_in integer default 0,
  today_tokens_out integer default 0,
  today_message_count integer default 0,
  today_date text,
  week_cost numeric default 0,
  week_key text,
  month_cost numeric default 0,
  month_key text,
  daily_limit numeric,
  monthly_limit numeric,
  per_txn_limit numeric,
  settlement_failed boolean default false,
  archived boolean default false,
  committed boolean default false,
  portal_slug text,                     -- unique slug for hosted docs portal (workspace.meter.chat)
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  deleted_at timestamptz default null
);

create unique index if not exists idx_chat_sessions_portal_slug
  on chat_sessions(user_id, portal_slug) where portal_slug is not null;

-- Chat messages
create table if not exists chat_messages (
  id text primary key,
  session_id text not null references chat_sessions(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null default '',
  model text,
  tokens_in integer,
  tokens_out integer,
  cache_creation_tokens integer,
  cache_read_tokens integer,
  cache_read_rate numeric,
  cost numeric,
  confidence numeric,
  settled boolean default false,
  receipt_status text,
  signature text,
  tx_hash text,
  cards jsonb,
  attachments jsonb,
  debate_trace jsonb,
  dissector_trace jsonb,
  documents jsonb,
  thinking text,
  is_fork_point boolean default false,
  fork_resolution text,
  timestamp bigint not null,
  created_at timestamptz default now()
);

-- Add columns for debate trace / thinking / attachments / dissector / fork state (run if table exists)
-- alter table chat_messages add column if not exists attachments jsonb;
-- alter table chat_messages add column if not exists debate_trace jsonb;
-- alter table chat_messages add column if not exists dissector_trace jsonb;
-- alter table chat_messages add column if not exists thinking text;
-- alter table chat_messages add column if not exists documents jsonb;
-- alter table chat_messages add column if not exists is_fork_point boolean default false;
-- alter table chat_messages add column if not exists fork_resolution text;

-- Cache token breakdown for auditable pricing (run if table exists)
-- alter table chat_messages add column if not exists cache_creation_tokens integer;
-- alter table chat_messages add column if not exists cache_read_tokens integer;
-- alter table chat_messages add column if not exists cache_read_rate numeric;

-- =============================================
-- VIEWS: workspaces & tracks
-- =============================================

-- Read-only projections of chat_sessions — makes the schema self-documenting.
-- Any agent or human looking at the DB immediately sees what a workspace/track is.

create or replace view workspaces as
select id, user_id, coalesce(workspace_name, project_name) as name,
       total_cost, today_cost, week_cost, month_cost,
       daily_limit, monthly_limit, per_txn_limit,
       settlement_failed, created_at, updated_at, deleted_at
from chat_sessions
where is_subtrack = false;

create or replace view tracks as
select id, parent_session_id as workspace_id, user_id,
       coalesce(workspace_name, project_name) as name,
       archived, committed, fork_message_id, total_cost, today_cost,
       created_at, updated_at, deleted_at
from chat_sessions
where is_subtrack = true and parent_session_id is not null;

-- =============================================
-- DECISIONS
-- =============================================

-- Decisions
create table if not exists decisions (
  id text primary key,
  user_id text not null,
  title text not null,
  status text not null default 'undecided',
  archived boolean default false,
  choice text,
  alternatives jsonb,
  reasoning text,
  session_id text,                      -- workspace session this decision belongs to
  project_id text,                      -- legacy alias for session_id
  chat_message_id text,
  category text,
  parent_decision_id text,
  version integer default 1,
  revisit_count integer default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- =============================================
-- LOG ENTRIES (public development log)
-- =============================================

create table if not exists log_entries (
  id text primary key,
  type text not null check (type in (
    'message_sent', 'decision_locked', 'debate_started',
    'path_forked', 'path_merged', 'workspace_created',
    'feedback_logged', 'commit_pushed'
  )),
  actor text not null default 'anon',    -- 'anon', 'meter', or first 6 chars of hashed user_id
  -- commit-specific fields
  commit_sha text,
  commit_url text,
  commit_repo text,
  commit_message text,
  -- feedback-specific
  feedback_text text,
  created_at timestamptz default now()
);

create index if not exists idx_log_entries_created_at on log_entries(created_at desc);

-- =============================================
-- API KEYS & USAGE (v1 API)
-- =============================================

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  wallet_address text unique not null,
  created_at timestamptz default now()
);

create table if not exists api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  key_hash text unique not null,
  key_prefix text not null,
  name text,
  active boolean default true,
  created_at timestamptz default now(),
  last_used_at timestamptz
);

create table if not exists usage_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  api_key_id uuid references api_keys(id),
  model text,
  tokens_in integer default 0,
  tokens_out integer default 0,
  created_at timestamptz default now()
);

-- SDK end-users (maps developer's external user IDs to internal Meter users)
create table if not exists sdk_end_users (
  id text primary key,
  developer_id uuid not null references users(id) on delete cascade,
  external_user_id text not null,
  stripe_customer_id text,
  card_last4 text,
  card_brand text,
  markup_multiplier numeric not null default 2,
  created_at timestamptz default now(),
  unique(developer_id, external_user_id)
);

-- =============================================
-- SETTLEMENT HISTORY
-- =============================================

create table if not exists settlement_history (
  id text primary key,
  user_id text not null references meter_users(id) on delete cascade,
  workspace_id text,
  amount numeric not null,
  stripe_payment_intent_id text,
  tx_hash text,
  message_count integer default 0,
  charge_count integer default 0,
  card_last4 text,
  card_brand text,
  status text not null default 'succeeded',
  created_at timestamptz default now()
);

-- =============================================
-- TX HISTORY (purchases: domains, cards, etc.)
-- =============================================

create table if not exists tx_history (
  id text primary key,
  user_id text not null references meter_users(id) on delete cascade,
  type text not null,
  description text,
  amount numeric,
  currency text default 'usd',
  status text default 'pending',
  metadata jsonb,
  session_id text,
  created_at timestamptz default now()
);

create index if not exists idx_tx_history_user on tx_history(user_id);

-- Spend limit columns on meter_users
-- (Run these as ALTER TABLE if table already exists)
-- alter table meter_users add column if not exists daily_limit numeric;
-- alter table meter_users add column if not exists monthly_limit numeric;
-- alter table meter_users add column if not exists per_txn_limit numeric;

-- Spend limit columns on chat_sessions (per workspace)
-- alter table chat_sessions add column if not exists daily_limit numeric;
-- alter table chat_sessions add column if not exists monthly_limit numeric;
-- alter table chat_sessions add column if not exists per_txn_limit numeric;

-- Week/month cost tracking on chat_sessions
-- alter table chat_sessions add column if not exists week_cost numeric default 0;
-- alter table chat_sessions add column if not exists week_key text;
-- alter table chat_sessions add column if not exists month_cost numeric default 0;
-- alter table chat_sessions add column if not exists month_key text;

-- Workspace id on settlement history
-- alter table settlement_history add column if not exists workspace_id text;

-- Subtrack metadata on chat_sessions (track vs workspace distinction)
-- alter table chat_sessions add column if not exists workspace_name text;
-- alter table chat_sessions add column if not exists is_subtrack boolean default false;
-- alter table chat_sessions add column if not exists parent_session_id text;

-- Portal slug for hosted documentation site (unique per workspace)
-- alter table chat_sessions add column if not exists portal_slug text;
-- create unique index if not exists idx_chat_sessions_portal_slug on chat_sessions(portal_slug) where portal_slug is not null;

-- Rename project_id → session_id on decisions and artifacts (keep project_id as legacy alias)
-- alter table decisions add column if not exists session_id text;
-- update decisions set session_id = project_id where session_id is null and project_id is not null;
-- alter table artifacts add column if not exists session_id text;
-- update artifacts set session_id = project_id where session_id is null and project_id is not null;

-- SDK: developer scoping on chat sessions
-- alter table chat_sessions add column if not exists developer_id uuid;

-- =============================================
-- INDEXES
-- =============================================

create index if not exists idx_meter_users_email on meter_users(email);
create index if not exists idx_passkey_credentials_user on passkey_credentials(user_id);
create index if not exists idx_auth_challenges_email on auth_challenges(email);
create index if not exists idx_oauth_tokens_user on oauth_tokens(user_id);
create index if not exists idx_oauth_tokens_workspace on oauth_tokens(workspace_id);
create index if not exists idx_chat_messages_session on chat_messages(session_id);
create index if not exists idx_chat_messages_timestamp on chat_messages(timestamp);
create index if not exists idx_chat_sessions_user on chat_sessions(user_id);
-- workspaces & tracks are views over chat_sessions — indexes live on chat_sessions
create index if not exists idx_decisions_user on decisions(user_id);
create index if not exists idx_decisions_user_session on decisions(user_id, session_id);
create index if not exists idx_artifacts_user_session on artifacts(user_id, session_id);
create index if not exists idx_settlement_history_user on settlement_history(user_id);
create index if not exists idx_settlement_history_workspace on settlement_history(workspace_id);
create index if not exists idx_sdk_end_users_developer on sdk_end_users(developer_id);
create index if not exists idx_sdk_end_users_lookup on sdk_end_users(developer_id, external_user_id);

-- =============================================
-- AUTH SESSIONS (server-side session tokens)
-- =============================================

create table if not exists auth_sessions (
  token text primary key,
  user_id text not null references meter_users(id) on delete cascade,
  created_at timestamptz default now(),
  expires_at timestamptz not null
);

create index if not exists idx_auth_sessions_user on auth_sessions(user_id);
create index if not exists idx_auth_sessions_expires on auth_sessions(expires_at);

-- =============================================
-- ACCOUNT TYPE (superadmin, standard)
-- =============================================

-- Add account_type column if it doesn't already exist
-- alter table meter_users add column if not exists account_type text not null default 'standard';

-- Markup multiplier (per-account pricing; default 2 = 2x consumer markup)
-- alter table meter_users add column if not exists markup_multiplier numeric not null default 2;

-- Set a@buxor.co as superadmin creator account (no settlement charges)
-- update meter_users set account_type = 'superadmin' where email = 'a@buxor.co';

-- =============================================
-- ARTIFACTS (strategy spec files)
-- =============================================

create table if not exists artifacts (
  id text primary key,
  user_id text not null references meter_users(id) on delete cascade,
  session_id text,                      -- workspace session this artifact belongs to
  project_id text,                      -- legacy alias for session_id
  file_path text not null,
  content text not null default '',
  status text not null default 'draft',
  category text not null default 'other',
  github_repo text,
  github_sha text,
  last_generated_at timestamptz,
  last_pushed_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_artifacts_user on artifacts(user_id);
create index if not exists idx_artifacts_project on artifacts(project_id);
create index if not exists idx_artifacts_session on artifacts(session_id);
create unique index if not exists idx_artifacts_user_project_path on artifacts(user_id, coalesce(project_id, ''), file_path);
create unique index if not exists idx_artifacts_user_session_path on artifacts(user_id, coalesce(session_id, ''), file_path);

-- =============================================
-- ROW LEVEL SECURITY
-- =============================================
-- All user-data tables enforce owner-only access via app.user_id context.

alter table chat_sessions enable row level security;
alter table chat_messages enable row level security;
alter table decisions enable row level security;
alter table artifacts enable row level security;
alter table settlement_history enable row level security;
alter table oauth_tokens enable row level security;
alter table meter_users enable row level security;
alter table passkey_credentials enable row level security;
alter table auth_sessions enable row level security;
alter table tx_history enable row level security;
alter table oauth_state enable row level security;
alter table auth_challenges enable row level security;
alter table log_entries enable row level security;
