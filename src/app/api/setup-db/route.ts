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
    total_cost numeric default 0,
    today_cost numeric default 0,
    today_tokens_in integer default 0,
    today_tokens_out integer default 0,
    today_message_count integer default 0,
    today_date text,
    daily_limit numeric,
    monthly_limit numeric,
    per_txn_limit numeric,
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
    signature text, tx_hash text, cards jsonb,
    timestamp bigint not null,
    created_at timestamptz default now()
  )`,
  `create table if not exists workspaces (
    id text primary key,
    user_id text not null,
    name text not null,
    created_at timestamptz default now()
  )`,
  `create table if not exists workspace_projects (
    id text primary key,
    workspace_id text not null references workspaces(id) on delete cascade,
    name text not null,
    created_at timestamptz default now()
  )`,
  `create table if not exists decisions (
    id text primary key,
    user_id text not null,
    title text not null,
    status text not null default 'undecided',
    archived boolean default false,
    choice text, alternatives jsonb, reasoning text,
    project_id text, chat_message_id text,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
  )`,
  `create table if not exists settlement_history (
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

  // Alter statements for existing deployments
  `alter table chat_sessions add column if not exists daily_limit numeric`,
  `alter table chat_sessions add column if not exists monthly_limit numeric`,
  `alter table chat_sessions add column if not exists per_txn_limit numeric`,
  `alter table settlement_history add column if not exists workspace_id text`,
  `alter table chat_sessions add column if not exists settlement_failed boolean default false`,
  `alter table oauth_tokens add column if not exists workspace_id text not null default ''`,
  `alter table oauth_tokens add column if not exists metadata jsonb`,
  // Remove duplicate rows before creating unique index (keep newest per user/provider/workspace)
  `delete from oauth_tokens a using oauth_tokens b
   where a.user_id = b.user_id and a.provider = b.provider and a.workspace_id = b.workspace_id
   and a.updated_at < b.updated_at`,
  `create unique index if not exists idx_oauth_tokens_unique on oauth_tokens(user_id, provider, workspace_id)`,
  `alter table oauth_state add column if not exists workspace_id text`,

  // File attachments support
  `alter table chat_messages add column if not exists attachments jsonb`,
  `insert into storage.buckets (id, name, public) values ('attachments', 'attachments', true) on conflict (id) do nothing`,
  `do $$ begin create policy "Public read access" on storage.objects for select using (bucket_id = 'attachments'); exception when duplicate_object then null; end $$`,

  // Debate trace + thinking persistence (survive logout/login)
  `alter table chat_messages add column if not exists debate_trace jsonb`,
  `alter table chat_messages add column if not exists thinking text`,

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

  // Indexes
  `create index if not exists idx_oauth_tokens_user on oauth_tokens(user_id)`,
  `create index if not exists idx_oauth_tokens_workspace on oauth_tokens(workspace_id)`,
  `create index if not exists idx_oauth_state_expires on oauth_state(expires_at)`,
  `create index if not exists idx_meter_users_email on meter_users(email)`,
  `create index if not exists idx_passkey_credentials_user on passkey_credentials(user_id)`,
  `create index if not exists idx_auth_challenges_email on auth_challenges(email)`,
  `create index if not exists idx_chat_messages_session on chat_messages(session_id)`,
  `create index if not exists idx_chat_sessions_user on chat_sessions(user_id)`,
  `create index if not exists idx_workspaces_user on workspaces(user_id)`,
  `create index if not exists idx_decisions_user on decisions(user_id)`,
  `create index if not exists idx_settlement_history_user on settlement_history(user_id)`,
  `create index if not exists idx_settlement_history_workspace on settlement_history(workspace_id)`,
  `create index if not exists idx_auth_sessions_user on auth_sessions(user_id)`,
  `create index if not exists idx_auth_sessions_expires on auth_sessions(expires_at)`,

  // Artifacts (strategy spec files generated by Meter)
  `create table if not exists artifacts (
    id text primary key,
    user_id text not null references meter_users(id) on delete cascade,
    project_id text,
    file_path text not null,
    content text not null default '',
    status text not null default 'draft',
    github_repo text,
    github_sha text,
    last_generated_at timestamptz,
    last_pushed_at timestamptz,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
  )`,
  `create index if not exists idx_artifacts_user on artifacts(user_id)`,
  `create index if not exists idx_artifacts_project on artifacts(project_id)`,
  `create unique index if not exists idx_artifacts_user_project_path on artifacts(user_id, coalesce(project_id, ''), file_path)`,
];

function getProjectRef(url: string): string | null {
  const match = url.match(/https:\/\/([^.]+)\.supabase\.co/);
  return match?.[1] ?? null;
}

async function runQuery(
  ref: string,
  accessToken: string,
  sql: string,
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${ref}/database/query`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ query: sql }),
    },
  );
  if (res.ok) return { ok: true };
  const errText = await res.text().catch(() => "unknown");
  return { ok: false, error: `${res.status}: ${errText}` };
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

  const results: { sql: string; ok: boolean; error?: string }[] = [];

  for (const sql of STATEMENTS) {
    const label = sql.replace(/\s+/g, " ").trim().slice(0, 80);
    try {
      const result = await runQuery(ref, accessToken, sql);
      results.push({ sql: label, ...result });
    } catch (err) {
      results.push({
        sql: label,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
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
