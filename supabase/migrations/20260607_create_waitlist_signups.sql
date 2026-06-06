-- Waitlist / request-invite signups captured from the public homepage.
-- Email-only capture; written server-side via the service role (see /api/waitlist).

create table if not exists waitlist_signups (
  id text primary key,
  email text not null,
  source text default 'homepage',
  created_at timestamptz default now()
);

-- One row per email (case-insensitive).
create unique index if not exists idx_waitlist_signups_email on waitlist_signups (lower(email));
create index if not exists idx_waitlist_signups_created_at on waitlist_signups (created_at desc);

-- Lock down: only server routes (service role) read/write. No anon access.
alter table waitlist_signups enable row level security;
