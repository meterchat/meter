import { NextResponse } from "next/server";

// One-time DB setup endpoint.
// Uses the Supabase Management API (requires SUPABASE_ACCESS_TOKEN).
// Runs each statement individually so ALTER effects are visible to later statements.
// Call once after deploying: GET https://meter.chat/api/setup-db

const STATEMENTS: string[] = [
  // Tables
  `create table if not exists meter_users (
    id text primary key,
    email text unique not null,
    stripe_customer_id text,
    card_last4 text,
    card_brand text,
    gmail_connected boolean default false,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
  )`,
  `create table if not exists passkey_credentials (
    credential_id text primary key,
    user_id text not null references meter_users(id) on delete cascade,
    public_key text not null,
    counter bigint not null default 0,
    device_type text,
    backed_up boolean default false,
    transports jsonb,
    created_at timestamptz default now()
  )`,
  `create table if not exists auth_challenges (
    id text primary key,
    email text not null,
    challenge text not null,
    type text not null check (type in ('register', 'login')),
    expires_at timestamptz not null,
    created_at timestamptz default now()
  )`,
  `create table if not exists chat_sessions (
    id text primary key,
    user_id text not null,
    project_name text not null,
    workspace_name text,
    is_subtrack boolean default false,
    parent_session_id text,
    fork_message_id text,
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
    created_at timestamptz default now(),
    updated_at timestamptz default now(),
    deleted_at timestamptz default null
  )`,
  `create table if not exists chat_messages (
    id text primary key,
    session_id text not null references chat_sessions(id) on delete cascade,
    role text not null check (role in ('user', 'assistant')),
    content text not null default '',
    model text, tokens_in integer, tokens_out integer,
    cost numeric, confidence numeric,
    settled boolean default false, receipt_status text,
    cards jsonb,
    attachments jsonb, debate_trace jsonb,
    dissector_trace jsonb, documents jsonb, thinking text,
    is_fork_point boolean default false,
    fork_resolution text,
    timestamp bigint not null,
    created_at timestamptz default now()
  )`,
  // ── Views: workspaces & tracks (read-only projections of chat_sessions) ──
  `create or replace view workspaces as
   select id, user_id, coalesce(workspace_name, project_name) as name,
          total_cost, today_cost, week_cost, month_cost,
          daily_limit, monthly_limit, per_txn_limit,
          settlement_failed, created_at, updated_at, deleted_at
   from chat_sessions
   where is_subtrack = false`,

  `drop view if exists tracks`,
  `create or replace view tracks as
   select id, parent_session_id as workspace_id, user_id,
          coalesce(workspace_name, project_name) as name,
          archived, committed, fork_message_id, total_cost, today_cost,
          created_at, updated_at, deleted_at
   from chat_sessions
   where is_subtrack = true and parent_session_id is not null`,

  `create table if not exists decisions (
    id text primary key,
    user_id text not null,
    title text not null,
    status text not null default 'undecided',
    archived boolean default false,
    choice text, alternatives jsonb, reasoning text,
    session_id text, project_id text, chat_message_id text,
    category text, parent_decision_id text,
    version integer default 1, revisit_count integer default 0,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
  )`,
  `create table if not exists settlement_history (
    id text primary key,
    user_id text not null references meter_users(id) on delete cascade,
    workspace_id text,
    amount numeric not null,
    stripe_payment_intent_id text,
    message_count integer default 0,
    charge_count integer default 0,
    card_last4 text,
    card_brand text,
    status text not null default 'succeeded',
    created_at timestamptz default now()
  )`,
  `create table if not exists oauth_tokens (
    id text primary key,
    user_id text not null references meter_users(id) on delete cascade,
    provider text not null,
    workspace_id text not null,
    access_token text not null,
    refresh_token text,
    expires_at timestamptz,
    scopes text,
    metadata jsonb,
    created_at timestamptz default now(),
    updated_at timestamptz default now(),
    unique(user_id, provider, workspace_id)
  )`,
  `create table if not exists oauth_state (
    id text primary key,
    user_id text not null,
    provider text not null,
    workspace_id text,
    pkce_verifier text,
    expires_at timestamptz not null,
    created_at timestamptz default now()
  )`,
  `create table if not exists auth_sessions (
    token text primary key,
    user_id text not null references meter_users(id) on delete cascade,
    created_at timestamptz default now(),
    expires_at timestamptz not null
  )`,
  `create table if not exists mcp_keys (
    id uuid primary key default gen_random_uuid(),
    user_id text not null references meter_users(id) on delete cascade,
    key_hash text unique not null,
    key_prefix text not null,
    encrypted_key text not null,
    active boolean default true,
    created_at timestamptz default now(),
    last_used_at timestamptz
  )`,

  `create table if not exists tx_history (
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
  )`,

  // Alter statements for existing deployments
  `alter table chat_sessions add column if not exists daily_limit numeric`,
  `alter table chat_sessions add column if not exists monthly_limit numeric`,
  `alter table chat_sessions add column if not exists per_txn_limit numeric`,
  `alter table settlement_history add column if not exists workspace_id text`,
  `alter table chat_sessions add column if not exists settlement_failed boolean default false`,
  `alter table chat_sessions add column if not exists workspace_name text`,
  `alter table chat_sessions add column if not exists is_subtrack boolean default false`,
  `alter table chat_sessions add column if not exists parent_session_id text`,
  `alter table oauth_tokens add column if not exists workspace_id text not null default ''`,
  `alter table oauth_tokens add column if not exists metadata jsonb`,
  // Remove duplicate rows before creating unique index (keep newest per user/provider/workspace)
  `delete from oauth_tokens a using oauth_tokens b
   where a.user_id = b.user_id and a.provider = b.provider and a.workspace_id = b.workspace_id
   and a.updated_at < b.updated_at`,
  `create unique index if not exists idx_oauth_tokens_unique on oauth_tokens(user_id, provider, workspace_id)`,
  `alter table chat_sessions add column if not exists archived boolean default false`,
  `alter table chat_sessions add column if not exists committed boolean default false`,
  `alter table chat_sessions add column if not exists fork_message_id text`,
  `alter table oauth_state add column if not exists workspace_id text`,

  // File attachments support
  `alter table chat_messages add column if not exists attachments jsonb`,
  `insert into storage.buckets (id, name, public) values ('attachments', 'attachments', true) on conflict (id) do nothing`,
  `do $$ begin create policy "Public read access" on storage.objects for select using (bucket_id = 'attachments'); exception when duplicate_object then null; end $$`,

  // Debate trace + thinking persistence (survive logout/login)
  `alter table chat_messages add column if not exists debate_trace jsonb`,
  `alter table chat_messages add column if not exists thinking text`,

  // Dissector trace persistence
  `alter table chat_messages add column if not exists dissector_trace jsonb`,

  // Document preview cards persistence (inline doc cards survive page reload)
  `alter table chat_messages add column if not exists documents jsonb`,

  // Fork state persistence (divider lines survive merge/close)
  `alter table chat_messages add column if not exists is_fork_point boolean default false`,
  `alter table chat_messages add column if not exists fork_resolution text`,

  // Cache token breakdown for auditable pricing receipts
  `alter table chat_messages add column if not exists cache_creation_tokens integer`,
  `alter table chat_messages add column if not exists cache_read_tokens integer`,
  `alter table chat_messages add column if not exists cache_read_rate numeric`,

  // Week/month cost tracking on sessions
  `alter table chat_sessions add column if not exists week_cost numeric default 0`,
  `alter table chat_sessions add column if not exists week_key text`,
  `alter table chat_sessions add column if not exists month_cost numeric default 0`,
  `alter table chat_sessions add column if not exists month_key text`,

  // Decision versioning, categories, and revisit tracking
  `alter table decisions add column if not exists category text`,
  `alter table decisions add column if not exists parent_decision_id text`,
  `alter table decisions add column if not exists version integer default 1`,
  `alter table decisions add column if not exists revisit_count integer default 0`,

  // Rename project_id → session_id on decisions and artifacts
  `alter table decisions add column if not exists session_id text`,
  `update decisions set session_id = project_id where session_id is null and project_id is not null`,
  `alter table artifacts add column if not exists session_id text`,
  `update artifacts set session_id = project_id where session_id is null and project_id is not null`,
  `alter table artifacts add column if not exists category text not null default 'other'`,

  // Soft-delete support for workspace deletion (7-day retention)
  `alter table chat_sessions add column if not exists deleted_at timestamptz default null`,

  // Account type (superadmin creator accounts skip settlement)
  `alter table meter_users add column if not exists account_type text not null default 'standard'`,
  `update meter_users set account_type = 'superadmin' where email = 'a@buxor.co' and account_type = 'standard'`,

  // Passkey-only auth: make email optional (collected at card setup, not signup)
  `alter table meter_users alter column email drop not null`,
  // Replace hard UNIQUE with partial unique (only enforce when email is present)
  `do $$ begin alter table meter_users drop constraint meter_users_email_key; exception when undefined_object then null; end $$`,
  `create unique index if not exists idx_meter_users_email_unique on meter_users(email) where email is not null`,
  // auth_challenges: email becomes nullable, add user_id for passkey-only flow
  `alter table auth_challenges alter column email drop not null`,
  `alter table auth_challenges add column if not exists user_id text`,

  // Anonymous user handles (short alphanumeric ID, e.g. "ab41ki")
  `alter table meter_users add column if not exists handle text`,
  `create unique index if not exists idx_meter_users_handle on meter_users(handle) where handle is not null`,

  // Hosted docs portal slug per workspace (e.g. docs.meter.chat/{handle}/{slug})
  `alter table chat_sessions add column if not exists portal_slug text`,
  // Portal slug only needs to be unique per user (URL is /docs/{handle}/{slug})
  `drop index if exists idx_chat_sessions_portal_slug`,
  `create unique index if not exists idx_chat_sessions_portal_slug on chat_sessions(user_id, portal_slug) where portal_slug is not null`,
  // Clean up old slugs with random suffixes — regenerate from workspace_name
  `update chat_sessions set portal_slug = lower(regexp_replace(regexp_replace(regexp_replace(trim(coalesce(workspace_name, project_name, 'workspace')), '[^a-zA-Z0-9\\s-]', '', 'g'), '\\s+', '-', 'g'), '-+', '-', 'g')) where portal_slug is not null`,

  // Public development log
  `create table if not exists log_entries (
    id text primary key,
    type text not null check (type in (
      'message_sent', 'decision_locked', 'debate_started',
      'path_forked', 'path_merged', 'workspace_created',
      'feedback_logged', 'commit_pushed'
    )),
    actor text not null default 'anon',
    commit_sha text,
    commit_url text,
    commit_repo text,
    feedback_text text,
    created_at timestamptz default now()
  )`,
  `create index if not exists idx_log_entries_created_at on log_entries(created_at desc)`,
  `alter table log_entries add column if not exists commit_message text`,
  `alter table log_entries add column if not exists preview text`,
  // Expand type check constraint to include Stripe events
  `alter table log_entries drop constraint if exists log_entries_type_check`,
  `alter table log_entries add constraint log_entries_type_check check (type in (
    'message_sent', 'decision_locked', 'debate_started',
    'path_forked', 'path_merged', 'workspace_created',
    'feedback_logged', 'commit_pushed',
    'payment_succeeded', 'payment_failed', 'auth_hold_created', 'refund_issued'
  ))`,

  // Indexes
  `create index if not exists idx_oauth_tokens_user on oauth_tokens(user_id)`,
  `create index if not exists idx_oauth_tokens_workspace on oauth_tokens(workspace_id)`,
  `create index if not exists idx_oauth_state_expires on oauth_state(expires_at)`,
  `create index if not exists idx_meter_users_email on meter_users(email)`,
  `create index if not exists idx_passkey_credentials_user on passkey_credentials(user_id)`,
  `create index if not exists idx_auth_challenges_email on auth_challenges(email)`,
  `create index if not exists idx_chat_messages_session on chat_messages(session_id)`,
  `create index if not exists idx_chat_sessions_user on chat_sessions(user_id)`,
  // workspaces & tracks are views over chat_sessions — indexes live on chat_sessions
  `create index if not exists idx_decisions_user on decisions(user_id)`,
  `create index if not exists idx_decisions_user_session on decisions(user_id, session_id)`,
  `create index if not exists idx_artifacts_user_session on artifacts(user_id, session_id)`,
  `create index if not exists idx_settlement_history_user on settlement_history(user_id)`,
  `create index if not exists idx_settlement_history_workspace on settlement_history(workspace_id)`,
  `create index if not exists idx_tx_history_user on tx_history(user_id)`,
  `create index if not exists idx_auth_sessions_user on auth_sessions(user_id)`,
  `create index if not exists idx_auth_sessions_expires on auth_sessions(expires_at)`,

  // Artifacts (strategy spec files generated by Meter)
  `create table if not exists artifacts (
    id text primary key,
    user_id text not null references meter_users(id) on delete cascade,
    session_id text,
    project_id text,
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
  )`,
  `create index if not exists idx_artifacts_user on artifacts(user_id)`,
  `create index if not exists idx_artifacts_project on artifacts(project_id)`,
  `create index if not exists idx_artifacts_session on artifacts(session_id)`,
  `create unique index if not exists idx_artifacts_user_project_path on artifacts(user_id, coalesce(project_id, ''), file_path)`,
  `create unique index if not exists idx_artifacts_user_session_path on artifacts(user_id, coalesce(session_id, ''), file_path)`,

  // ── RLS: helper function to set app context ──
  `create or replace function set_app_user(p_user_id text)
   returns void as $$
   begin perform set_config('app.user_id', p_user_id, true); end;
   $$ language plpgsql security definer`,

  // ── RLS: enable on all user-data tables ──
  `alter table chat_sessions enable row level security`,
  `alter table chat_messages enable row level security`,
  `alter table decisions enable row level security`,
  `alter table artifacts enable row level security`,
  `alter table settlement_history enable row level security`,
  `alter table oauth_tokens enable row level security`,
  `alter table meter_users enable row level security`,
  `alter table passkey_credentials enable row level security`,
  `alter table auth_sessions enable row level security`,
  `alter table mcp_keys enable row level security`,
  `alter table tx_history enable row level security`,
  // workspaces & tracks are views — RLS inherited from chat_sessions
  `alter table oauth_state enable row level security`,
  `alter table auth_challenges enable row level security`,

  // ── RLS: policies (idempotent via exception handler) ──
  `do $$ begin
     create policy chat_sessions_owner on chat_sessions for all
       using (user_id = current_setting('app.user_id', true));
   exception when duplicate_object then null; end $$`,

  `do $$ begin
     create policy chat_messages_owner on chat_messages for all
       using (session_id in (select id from chat_sessions where user_id = current_setting('app.user_id', true)));
   exception when duplicate_object then null; end $$`,

  `do $$ begin
     create policy decisions_owner on decisions for all
       using (user_id = current_setting('app.user_id', true));
   exception when duplicate_object then null; end $$`,

  `do $$ begin
     create policy artifacts_owner on artifacts for all
       using (user_id = current_setting('app.user_id', true));
   exception when duplicate_object then null; end $$`,

  `do $$ begin
     create policy settlement_history_owner on settlement_history for all
       using (user_id = current_setting('app.user_id', true));
   exception when duplicate_object then null; end $$`,

  `do $$ begin
     create policy oauth_tokens_owner on oauth_tokens for all
       using (user_id = current_setting('app.user_id', true));
   exception when duplicate_object then null; end $$`,

  `do $$ begin
     create policy meter_users_self on meter_users for all
       using (id = current_setting('app.user_id', true));
   exception when duplicate_object then null; end $$`,

  `do $$ begin
     create policy passkey_credentials_owner on passkey_credentials for all
       using (user_id = current_setting('app.user_id', true));
   exception when duplicate_object then null; end $$`,

  `do $$ begin
     create policy auth_sessions_owner on auth_sessions for all
       using (user_id = current_setting('app.user_id', true));
   exception when duplicate_object then null; end $$`,

  `do $$ begin
     create policy mcp_keys_owner on mcp_keys for all
       using (user_id = current_setting('app.user_id', true));
   exception when duplicate_object then null; end $$`,

  `do $$ begin
     create policy tx_history_owner on tx_history for all
       using (user_id::text = current_setting('app.user_id', true));
   exception when duplicate_object then null; end $$`,

  // workspaces & tracks views inherit chat_sessions_owner policy — no separate policies needed

  `do $$ begin
     create policy oauth_state_owner on oauth_state for all
       using (user_id = current_setting('app.user_id', true));
   exception when duplicate_object then null; end $$`,

  // auth_challenges must be open for unauthenticated register/login flows
  `do $$ begin
     create policy auth_challenges_open on auth_challenges for all
       using (true);
   exception when duplicate_object then null; end $$`,

  // log_entries is public — open read/write for all (no user ownership)
  `alter table log_entries enable row level security`,
  `do $$ begin
     create policy log_entries_open on log_entries for all
       using (true);
   exception when duplicate_object then null; end $$`,

  // Enforce: subtracks must always have a parent_session_id
  `do $$ begin
     alter table chat_sessions add constraint chk_subtrack_has_parent
       check (is_subtrack = false or parent_session_id is not null);
   exception when duplicate_object then null; end $$`,

  // ── RLS: v1 API tables (users, api_keys, usage_records, sdk_end_users) ──
  `do $$ begin alter table users enable row level security; exception when undefined_table then null; end $$`,
  `do $$ begin alter table api_keys enable row level security; exception when undefined_table then null; end $$`,
  `do $$ begin alter table usage_records enable row level security; exception when undefined_table then null; end $$`,
  `do $$ begin alter table sdk_end_users enable row level security; exception when undefined_table then null; end $$`,

  `do $$ begin
     create policy users_self on users for all
       using (id::text = current_setting('app.user_id', true));
   exception when duplicate_object then null; when undefined_table then null; end $$`,

  `do $$ begin
     create policy api_keys_owner on api_keys for all
       using (user_id::text = current_setting('app.user_id', true));
   exception when duplicate_object then null; when undefined_table then null; end $$`,

  `do $$ begin
     create policy usage_records_owner on usage_records for all
       using (user_id::text = current_setting('app.user_id', true));
   exception when duplicate_object then null; when undefined_table then null; end $$`,

  `do $$ begin
     create policy sdk_end_users_owner on sdk_end_users for all
       using (developer_id::text = current_setting('app.user_id', true));
   exception when duplicate_object then null; when undefined_table then null; end $$`,

  // ── Global admin config (single-row, controls markup / enabled models / commands) ──
  `create table if not exists app_config (
    id text primary key default 'global',
    markup_multiplier numeric not null default 2,
    enabled_models jsonb not null default '[]'::jsonb,
    enabled_commands jsonb not null default '[]'::jsonb,
    free_usd_credit numeric not null default 0,
    updated_at timestamptz not null default now(),
    updated_by text references meter_users(id)
  )`,
  `insert into app_config (id) values ('global') on conflict (id) do nothing`,
  // app_config is public-read (needed by /api/auth/me), write gated by superadmin in API
  `alter table app_config enable row level security`,
  `do $$ begin
     create policy app_config_read on app_config for select using (true);
   exception when duplicate_object then null; end $$`,
  `do $$ begin
     create policy app_config_write on app_config for all
       using (current_setting('app.user_id', true) is not null);
   exception when duplicate_object then null; end $$`,

  // Free USD credit per user (deducted before card charges at settlement)
  `alter table meter_users add column if not exists free_credit_remaining numeric not null default 0`,

  // Sync markup multiplier to 2x everywhere
  `update app_config set markup_multiplier = 2 where id = 'global' and markup_multiplier != 2`,

  // Bonus credit gating: first N signups get $X credit
  `alter table app_config add column if not exists bonus_credit_limit integer not null default 100`,
  `alter table app_config add column if not exists bonus_credit_amount numeric not null default 10`,

  // ── Remove legacy crypto/blockchain columns ──
  `alter table chat_messages drop column if exists signature`,
  `alter table chat_messages drop column if exists tx_hash`,
  `alter table settlement_history drop column if exists tx_hash`,
  // wallet_address: make nullable for existing rows, no longer required
  `do $$ begin alter table users alter column wallet_address drop not null; exception when undefined_table then null; when undefined_column then null; end $$`,

  // Reload PostgREST schema cache so new columns (preview, commit_message) are visible via REST API
  `notify pgrst, 'reload schema'`,

  // Function to fetch log entries with all columns (bypasses PostgREST schema cache)
  `create or replace function get_log_entries(p_limit int default 100, p_before timestamptz default null)
   returns table(
     id text, type text, actor text, commit_sha text, commit_url text,
     commit_repo text, commit_message text, feedback_text text, preview text,
     created_at timestamptz
   ) as $$
   begin
     return query
       select le.id, le.type, le.actor, le.commit_sha, le.commit_url,
              le.commit_repo, le.commit_message, le.feedback_text, le.preview,
              le.created_at
       from log_entries le
       where (p_before is null or le.created_at < p_before)
       order by le.created_at desc
       limit p_limit;
   end;
   $$ language plpgsql security definer`,
];

function getProjectRef(url: string): string | null {
  const match = url.match(/https:\/\/([^.]+)\.supabase\.co/);
  return match?.[1] ?? null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function runQuery(
  ref: string,
  accessToken: string,
  sql: string,
): Promise<{ ok: boolean; error?: string }> {
  const maxRetries = 4;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const res = await fetch(
      `https://api.supabase.com/v1/projects/${ref}/database/query`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ query: sql }),
        signal: controller.signal,
      },
    );

    clearTimeout(timeout);
    if (res.ok) return { ok: true };

    // Retry on 429 with exponential backoff
    if (res.status === 429 && attempt < maxRetries) {
      await sleep(2000 * Math.pow(2, attempt)); // 2s, 4s, 8s, 16s
      continue;
    }

    const errText = await res.text().catch(() => "unknown");
    return { ok: false, error: `${res.status}: ${errText}` };
  }
  return { ok: false, error: "max retries exceeded" };
}

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN;

  if (!url) {
    return NextResponse.json(
      { error: "Missing NEXT_PUBLIC_SUPABASE_URL" },
      { status: 500 },
    );
  }

  if (!accessToken) {
    const schema = STATEMENTS.join(";\n") + ";";
    return NextResponse.json(
      {
        success: false,
        error: "SUPABASE_ACCESS_TOKEN is not configured",
        help: "Set SUPABASE_ACCESS_TOKEN in your env vars, then call GET /api/setup-db again. Get your personal access token at https://supabase.com/dashboard/account/tokens. Alternatively, copy the SQL below and paste it into your Supabase SQL Editor.",
        schema,
      },
      { status: 400 },
    );
  }

  const ref = getProjectRef(url);
  if (!ref) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Could not extract project ref from NEXT_PUBLIC_SUPABASE_URL. Expected format: https://<ref>.supabase.co",
      },
      { status: 400 },
    );
  }

  // Batch statements into groups of ~10 to reduce API calls and avoid 429s.
  // Each batch is joined with ";\n" and sent as a single query.
  const BATCH_SIZE = 10;
  const batches: string[][] = [];
  for (let i = 0; i < STATEMENTS.length; i += BATCH_SIZE) {
    batches.push(STATEMENTS.slice(i, i + BATCH_SIZE));
  }

  const results: { sql: string; ok: boolean; error?: string }[] = [];

  for (let b = 0; b < batches.length; b++) {
    const batch = batches[b];
    const combined = batch.join(";\n");
    const label = `batch ${b + 1}/${batches.length} (${batch.length} stmts)`;
    try {
      const result = await runQuery(ref, accessToken, combined);
      results.push({ sql: label, ...result });
    } catch (err) {
      results.push({
        sql: label,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    // Small delay between batches to avoid rate limits
    if (b < batches.length - 1) await sleep(500);
  }

  const allOk = results.every((r) => r.ok);
  const failed = results.filter((r) => !r.ok);
  return NextResponse.json(
    {
      success: allOk,
      method: "management-api",
      ...(allOk
        ? { message: `All ${results.length} statements executed successfully` }
        : { failed }),
      total: results.length,
      ok: results.filter((r) => r.ok).length,
    },
    { status: allOk ? 200 : 500 },
  );
}
