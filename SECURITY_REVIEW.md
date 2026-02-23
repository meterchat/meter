# Security Review: PRs #81 - #120

## Summary

Reviewed 40 pull requests for security vulnerabilities and potential data leaks. Found **13 security issues** across 7 PRs, ranging from CRITICAL to LOW severity.

---

## Findings

### PR #81 — SQL Injection in Supabase Connector

**Severity: CRITICAL**
**Description:** The `supabaseQuery` function accepts arbitrary SQL queries from user input and forwards them directly to the Supabase API without any sanitization, parameterization, or allow-listing. An attacker who connects their Supabase instance could potentially execute arbitrary SQL, but more critically, the AI agent constructs and executes these queries based on user chat prompts, meaning prompt injection could lead to destructive SQL execution (DROP TABLE, data exfiltration, etc.) against the user's own database.

**Relevant code:**

```typescript
// src/lib/connectors/supabase-connector.ts (lines 30-70)
export async function supabaseQuery(
  apiKey: string,
  query: string,  // <-- Unsanitized user-supplied SQL
  metadata?: Record<string, unknown> | null
) {
  // ...
  const res = await fetch(`${base}/rest/v1/rpc/`, {
    method: "POST",
    headers: {
      apikey: apiKey,
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),  // <-- Raw SQL passed directly
  });

  if (!res.ok) {
    const sqlRes = await fetch(`${base}/pg/query`, {
      method: "POST",
      // ...
      body: JSON.stringify({ query }),  // <-- Raw SQL fallback endpoint
    });
  }
}
```

**Recommendation:** Implement query allow-listing (read-only SELECT statements only), parameterized queries, or at minimum validate that the query is a safe read operation before execution.

---

### PR #85 — Database Schema Leak via Unauthenticated Endpoint

**Severity: MEDIUM**
**Description:** The `/api/setup-db` GET endpoint returns the full database schema SQL to any caller when `SUPABASE_ACCESS_TOKEN` is not configured. This endpoint has no authentication and exposes the complete database structure including all table names, column names, constraints, and relationships. This information aids attackers in crafting targeted attacks.

**Relevant code:**

```typescript
// src/app/api/setup-db/route.ts
export async function GET() {
  // ...
  if (!accessToken) {
    return NextResponse.json(
      {
        success: false,
        error: "SUPABASE_ACCESS_TOKEN is not configured",
        help: "...",
        schema: TABLES_SQL + ALTERS_SQL + INDEXES_SQL,  // <-- Full schema returned
      },
      { status: 400 },
    );
  }
}
```

**Recommendation:** Remove the schema from the error response, or add authentication to this endpoint. The schema should only be available to authenticated administrators.

---

### PR #93 — Cross-Workspace Token Deletion

**Severity: HIGH**
**Description:** The `storeApiKey` function deletes ALL OAuth tokens for a user+provider combination across ALL workspaces before inserting the new one. This means connecting a service in one workspace silently disconnects it from every other workspace the user has. This is a data integrity issue that could lead to service disruption and, in a multi-tenant context, unexpected loss of access to connected services.

**Relevant code:**

```typescript
// src/lib/oauth.ts
export async function storeApiKey(
  userId: string,
  provider: string,
  workspaceId: string,
  apiKey: string,
  metadata?: Record<string, unknown> | null
): Promise<void> {
  const supabase = getSupabaseServer();

  // Deletes ALL tokens for this provider regardless of workspace
  await supabase
    .from("oauth_tokens")
    .delete()
    .eq("user_id", userId)
    .eq("provider", provider);
    // Missing: .eq("workspace_id", workspaceId)
  // ...
}
```

**Recommendation:** Add `.eq("workspace_id", workspaceId)` to scope the deletion to the current workspace only, consistent with how `storeToken` was updated.

---

### PR #94 — Unauthenticated Stripe Balance & Payout Endpoints

**Severity: CRITICAL**
**Description:** Two new API routes (`/api/stripe/balance` and `/api/stripe/payout`) operate on the platform's Stripe account with absolutely no authentication or authorization checks. Any unauthenticated user can:
1. View the platform's complete Stripe balance (available and pending funds) and recent payout history
2. Initiate payouts from the platform's Stripe account to its connected bank account for arbitrary amounts

This is a direct financial exposure that could drain the platform's Stripe balance.

**Relevant code:**

```typescript
// src/app/api/stripe/balance/route.ts — NO AUTH CHECK
export async function GET() {
  try {
    const [balance, payouts] = await Promise.all([
      stripe.balance.retrieve(),        // Platform balance exposed
      stripe.payouts.list({ limit: 10 }),  // Payout history exposed
    ]);
    return NextResponse.json({ balance: /* ... */, recentPayouts: /* ... */ });
  }
}

// src/app/api/stripe/payout/route.ts — NO AUTH CHECK
export async function POST(req: NextRequest) {
  try {
    const { amount, currency } = await req.json();
    // ...
    const payout = await stripe.payouts.create({  // Anyone can trigger payouts
      amount: payoutAmountCents,
      currency: cur,
      description: "Meter platform payout",
    });
    return NextResponse.json({ success: true, payout: /* ... */ });
  }
}
```

**Recommendation:** Add `requireAuth()` and superadmin-only authorization checks to both endpoints immediately. These should be restricted to platform administrators only.

---

### PR #111 — Hardcoded Superadmin Email in SQL Migration

**Severity: HIGH**
**Description:** A SQL migration statement hardcodes a specific email address (`a@buxor.co`) as a superadmin user. Superadmin accounts bypass all billing (settlement is "waived"), skip all spend limits, and skip exposure cap checks. This creates multiple issues:
1. A hardcoded privileged email in source code is a security anti-pattern
2. The superadmin role grants complete billing bypass with no audit trail beyond "waived" status
3. If someone registers with this email on a fresh deployment, they automatically get superadmin privileges

**Relevant code:**

```sql
-- src/app/api/setup-db/route.ts
`alter table meter_users add column if not exists account_type text not null default 'standard'`,
`update meter_users set account_type = 'superadmin' where email = 'a@buxor.co' and account_type = 'standard'`,
```

The superadmin then bypasses billing and spend limits:

```typescript
// src/app/api/billing/settle/route.ts
if (await isSuperAdmin(userId)) {
  // Skip Stripe charge entirely, mark as "waived"
  return NextResponse.json({ success: true, amountCharged: 0, waived: true });
}

// src/app/api/chat/route.ts
if (projectId && !(await isSuperAdmin(userId))) {
  // Spend limits only enforced for non-superadmin
}
```

**Recommendation:** Remove the hardcoded email from the migration SQL. Manage superadmin accounts through a secure admin panel or environment variable, not in source code. Add proper audit logging for superadmin actions.

---

### PR #111 — Account Type Exposed in Auth Response

**Severity: MEDIUM**
**Description:** The `accountType` field (including `"superadmin"`) is returned to the client in the authentication response. While the server-side check is what matters for security, exposing the account type to the client reveals the internal authorization model and could guide attackers toward privilege escalation attempts.

**Relevant code:**

```typescript
// src/app/api/auth/login/route.ts
const response = NextResponse.json({
  verified: true,
  user: {
    id: user?.id,
    email: user?.email,
    // ...
    accountType: user?.account_type ?? "standard",  // Exposes role to client
  },
});
```

**Recommendation:** Remove `accountType` from the client-facing auth response. Server-side authorization checks are sufficient; the client does not need to know about internal role types.

---

### PR #81 — Missing Input Validation on Connector Parameters

**Severity: LOW**
**Description:** Several connector functions accept parameters (like `account_id` in Mercury, `event` in PostHog) directly from user/AI input without validation beyond basic type checks. While these are passed to third-party APIs that should handle their own validation, the lack of input validation could lead to unexpected API calls or error information disclosure.

**Relevant code:**

```typescript
// src/lib/connectors/mercury.ts
export async function listTransactions(
  apiKey: string,
  params: { limit?: number; account_id?: string }
) {
  const accountId = params.account_id;  // No validation on format/content
  // ...
  const data = await mercuryFetch(
    apiKey,
    `/account/${accountId}/transactions?limit=${limit}`  // Direct interpolation
  );
}
```

**Recommendation:** Validate that `account_id` and similar parameters match expected formats (e.g., UUID pattern) before passing them to API URLs to prevent path traversal or injection in the URL.

---

## PRs with No Security Issues

The following PRs were reviewed and found to have no security vulnerabilities:

- **PR #82** — UI refactoring (actions-bar component)
- **PR #83** — OAuth workspace scoping (security improvement)
- **PR #84** — Type fixes and session sync improvements
- **PR #86** — Setup-db SQL ordering fix
- **PR #87** — Setup-db phased execution
- **PR #88** — Setup-db individual statement execution
- **PR #89** — Setup-db ALTER for workspace_id column
- **PR #90** — OAuth error handling improvements
- **PR #91** — OAuth dedup before unique index
- **PR #92** — Inline card form, removed AuthorizeScreen gate
- **PR #95** — Command bar and slash commands (UI)
- **PR #96** — Command bar drill-down UI
- **PR #97** — Slash command flat list refactor
- **PR #98** — Draft message persistence in localStorage
- **PR #99** — Scroll-to-bottom button repositioning
- **PR #100** — Workspace card assignment, landing page redesign
- **PR #101** — Server-side auth sessions (major security improvement: `requireAuth()`)
- **PR #102** — Scoped session IDs to prevent cross-user collisions
- **PR #103** — Session migration preservation improvements
- **PR #104** — Decisions API endpoint with proper auth
- **PR #105** — Combined PR: auth, sessions, setup-db (security improvement)
- **PR #106** — Spend limit session ID resolution cleanup
- **PR #107** — Exposure cap and settlement failure tracking
- **PR #108** — Stripe customer `ensureStripeCustomer` helper, card form refactor
- **PR #109** — CardElement migration, workspace ID in tool context
- **PR #110** — Aggregated token usage across tool rounds
- **PR #112** — Context window trimming for cost management
- **PR #113** — Cache-aware cost breakdown
- **PR #114** — Debate prompt improvements
- **PR #115** — xAI/Grok model support, pricing to 2x markup
- **PR #116** — Model picker UI styling
- **PR #117** — Debate trigger extraction fix
- **PR #118** — Abort controller for streaming, stop button
- **PR #119** — Fallback rerouting with reason display
- **PR #120** — Button styling and minor UI polish

---

## Risk Summary

| Severity | Count | PRs |
|----------|-------|-----|
| CRITICAL | 2 | #81, #94 |
| HIGH | 2 | #93, #111 |
| MEDIUM | 2 | #85, #111 |
| LOW | 1 | #81 |

**Most urgent fixes needed:**
1. **PR #94**: Add authentication to `/api/stripe/balance` and `/api/stripe/payout` immediately — these allow unauthenticated financial operations on the platform's Stripe account.
2. **PR #81**: Add SQL injection protections to the Supabase connector query function.
3. **PR #111**: Remove hardcoded superadmin email from migration SQL.
4. **PR #93**: Fix cross-workspace token deletion scope.
