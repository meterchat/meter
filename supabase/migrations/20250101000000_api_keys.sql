-- API Keys for MCP integration
-- Each workspace can have multiple API keys

create table if not exists public.api_keys (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null default 'Default',
  key_hash text not null,
  key_prefix text not null, -- first 8 chars for display (e.g., "mtr_a1b2...")
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  
  constraint api_keys_key_hash_unique unique (key_hash)
);

-- Index for fast lookup during API auth
create index if not exists idx_api_keys_key_hash on public.api_keys(key_hash) where revoked_at is null;
create index if not exists idx_api_keys_workspace_id on public.api_keys(workspace_id);

-- RLS
alter table public.api_keys enable row level security;

-- Users can manage API keys for workspaces they belong to
create policy "Users can view their workspace API keys"
  on public.api_keys for select
  using (
    workspace_id in (
      select id from public.workspaces 
      where owner_id = auth.uid()
    )
  );

create policy "Users can create API keys for their workspaces"
  on public.api_keys for insert
  with check (
    workspace_id in (
      select id from public.workspaces 
      where owner_id = auth.uid()
    )
  );

create policy "Users can revoke their workspace API keys"
  on public.api_keys for update
  using (
    workspace_id in (
      select id from public.workspaces 
      where owner_id = auth.uid()
    )
  );
