# Implementation Plan: Feedback Button + Public Log Page

## Overview

Two features:
1. **Feedback button** in inspector footer — simple text submission, no AI
2. **Public log page** at `log.meter.chat` — reverse-chronological development feed + decisions panel

---

## Part 1: Database — `log_entries` Table

A single unified table for all three entry types (commits, feedback, status updates):

```sql
create table if not exists log_entries (
  id text primary key,
  type text not null check (type in ('commit', 'feedback', 'status')),
  content text not null,
  -- commit-specific fields
  commit_sha text,
  commit_url text,
  commit_author text,
  commit_repo text,
  commit_branch text,
  -- optional metadata
  user_id text,           -- null for anonymous feedback
  metadata jsonb,
  created_at timestamptz default now()
);
```

**Why single table:** All three types render in one reverse-chronological feed. A single table makes the query simple (`SELECT * FROM log_entries ORDER BY created_at DESC`) with type-based rendering on the frontend.

---

## Part 2: Inspector Feedback Button

### Location
In the inspector footer bar (lines 163-172 of `inspector.tsx`), right side — next to existing "Manage workspace" button on the left.

### UI Flow
1. **Default state:** Small button with message-square icon + "Feedback" text, matching existing `font-mono text-[11px] text-muted-foreground/50` styling
2. **Click → Dropup:** A popover opening upward from the button with:
   - Textarea (3 rows, auto-expand) with placeholder "Share feedback, ideas, or bugs..."
   - Submit button
   - Simple, minimal design matching inspector aesthetic
3. **After submit:** Badge appears inline replacing the button temporarily: `"feedback logged"` in a distinct color (blue/indigo vs the green/emerald of "decision logged")
4. Badge auto-dismisses after 3 seconds, button returns

### API Call
`POST /api/log` with `{ type: "feedback", content: "..." }` — no auth required.

---

## Part 3: API Routes

### `POST /api/log` — Create log entry
- **No auth required** (for anonymous feedback)
- Accepts `{ type, content, ...optional fields }`
- For type "feedback": just content
- For type "status": content + optional metadata (founder-only, but enforced later)
- For type "commit": all commit fields (from webhook)
- Rate-limited by IP (simple in-memory or header check)

### `GET /api/log` — Fetch log entries
- **Public endpoint** (no auth)
- Returns reverse-chronological entries
- Query params: `?limit=50&offset=0&type=commit|feedback|status`
- Used by the public log page

### `GET /api/log/decisions` — Fetch locked decisions for the log page
- **Public endpoint** (no auth)
- Queries decisions table for the user's main workspace
- Scoped by `user_id` (the founder's ID, stored as env var `METER_FOUNDER_USER_ID`) and `session_id` (main workspace session, stored as env var `METER_MAIN_SESSION_ID`)
- Only returns `status = 'decided'` and `archived = false`
- Returns mapped decision objects

### `POST /api/log/webhook` — GitHub webhook receiver
- Validates GitHub webhook signature (`X-Hub-Signature-256`)
- On `push` events: creates one log_entry per commit
- Webhook secret stored as `GITHUB_WEBHOOK_SECRET` env var

---

## Part 4: Public Log Page (`/log`)

### Routing
Add `log.meter.chat` to middleware.ts, rewriting to `/log`:
```ts
const LOG_HOST = "log.meter.chat";
if (hostname === LOG_HOST || hostname.startsWith("log.meter")) {
  if (!pathname.startsWith("/log") && !pathname.startsWith("/api") && ...) {
    url.pathname = `/log${pathname}`;
    return NextResponse.rewrite(url);
  }
}
```

### File structure
```
src/app/log/
  layout.tsx      — log-specific layout (split theme, fonts)
  page.tsx        — main log page (server component, fetches initial data)
  components/
    log-feed.tsx        — left side: reverse-chronological feed
    log-entry.tsx       — individual entry card (commit/feedback/status)
    decisions-panel.tsx — right side: locked decisions
    log-header.tsx      — top header bar
    theme-toggle.tsx    — light/dark mode toggle
```

### Layout: "Half White Half Black"
- **Left 60%** — Light background (`bg-white text-gray-900`): The feed
- **Right 40%** — Dark background (`bg-black text-gray-100`): Locked decisions panel
- This split is always visible on desktop (no collapse)
- On mobile: stacks vertically, feed on top, decisions below (or tabbed)

### Left Side: Feed (60%)
- Header: "meter.log" or "Meter Development Log" with subtle branding
- Filter chips: All / Commits / Feedback / Status
- Each entry shows:
  - **Commit:** Git icon, commit message, sha (short), repo, timestamp, link to GitHub
  - **Feedback:** Message icon, feedback text, "anonymous" label, timestamp
  - **Status:** Megaphone/flag icon, status text, "founder" label, timestamp
- Reverse chronological, paginated or infinite scroll
- Minimal, clean design with monospace elements matching Meter's aesthetic

### Right Side: Decisions Panel (40%)
- Header: "Decisions" with count
- Each decision card shows:
  - Title
  - Category badge
  - Choice (the decision made)
  - Version number if > 1
  - Timestamp
- Dark theme with subtle borders
- Scrollable independently

### Theme Toggle
- Single toggle button in the header
- Toggles between:
  - **Default:** Left light / right dark
  - **Inverted:** Left dark / right light (full dark mode feel)
- Uses CSS classes on the container, not system preference

---

## Part 5: Environment Variables Needed

```env
METER_FOUNDER_USER_ID=...       # Your Meter user_id (for scoping decisions)
METER_MAIN_SESSION_ID=...       # Your main workspace session_id
GITHUB_WEBHOOK_SECRET=...       # For validating GitHub webhook payloads
```

---

## Implementation Order

1. **DB migration** — Create `log_entries` table
2. **API routes** — `/api/log` (POST + GET), `/api/log/decisions` (GET), `/api/log/webhook` (POST)
3. **Inspector feedback button** — UI in inspector.tsx footer
4. **Middleware** — Add `log.meter.chat` → `/log` rewriting
5. **Log page layout** — Split-theme layout
6. **Log page components** — Feed, entries, decisions panel
7. **GitHub webhook setup** — Instructions/docs for connecting

---

## Design Decisions

- **Single `log_entries` table** vs separate tables: Single table is simpler for the unified feed query
- **Env vars for workspace scoping** vs DB lookup: Env vars are faster, no extra query, configured once in Vercel
- **No auth on feedback**: Reduces friction. Rate limiting by IP prevents abuse
- **SSR + client hydration** for the log page: Initial data fetched server-side for fast load, client-side polling for live updates (optional)
- **No AI on the log page**: Pure data display, zero inference cost
