-- Meter: Full database schema
-- Run this in the Supabase SQL editor (Dashboard > SQL Editor)

-- =============================================
-- USERS & AUTH
-- =============================================

-- Users table (email-based accounts)
create table if not exists meter_users (
  id text primary key,
  email text unique not null,
  account_type text not null default 'standard',  -- 'standard' | 'superadmin'
  markup_multiplier numeric not null default 1,   -- per-account pricing multiplier (1 = at-cost)
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
  total_cost numeric default 0,
  today_cost numeric default 0,
  today_tokens_in integer default 0,
  today_tokens_out integer default 0,
  today_message_count integer default 0,
  today_date text,
  daily_limit numeric,
  monthly_limit numeric,
  per_txn_limit numeric,
  settlement_failed boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  deleted_at timestamptz default null
);

-- Chat messages
create table if not exists chat_messages (
  id text primary key,
  session_id text not null references chat_sessions(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null default '',
  model text,
  tokens_in integer,
  tokens_out integer,
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
  thinking text,
  timestamp bigint not null,
  created_at timestamptz default now()
);

-- Add columns for debate trace / thinking / attachments / dissector (run if table exists)
-- alter table chat_messages add column if not exists attachments jsonb;
-- alter table chat_messages add column if not exists debate_trace jsonb;
-- alter table chat_messages add column if not exists dissector_trace jsonb;
-- alter table chat_messages add column if not exists thinking text;

-- =============================================
-- WORKSPACES
-- =============================================

-- Workspaces
create table if not exists workspaces (
  id text primary key,
  user_id text not null,
  name text not null,
  created_at timestamptz default now()
);

-- Workspace projects / tracks
create table if not exists workspace_projects (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  name text not null,
  created_at timestamptz default now()
);

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
  markup_multiplier numeric not null default 1,
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
create index if not exists idx_workspaces_user on workspaces(user_id);
create index if not exists idx_workspace_projects_workspace on workspace_projects(workspace_id);
create index if not exists idx_decisions_user on decisions(user_id);
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

-- Markup multiplier (per-account pricing override; default 1 = at-cost)
-- alter table meter_users add column if not exists markup_multiplier numeric not null default 1;

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
  github_repo text,
  github_sha text,
  last_generated_at timestamptz,
  last_pushed_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_artifacts_user on artifacts(user_id);
create index if not exists idx_artifacts_project on artifacts(project_id);
create unique index if not exists idx_artifacts_user_project_path on artifacts(user_id, coalesce(project_id, ''), file_path);
