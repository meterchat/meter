# Meter Security Audit Report

**Date:** 2026-03-07
**Scope:** Full codebase review — security vulnerabilities, code bugs, logic errors, shortcuts
**Files reviewed:** ~120+ source files across API routes, libraries, connectors, components, SDK packages, schema, and configuration

---

## Executive Summary

The codebase has **11 critical**, **12 high**, **15 medium**, and **14 low** severity findings. The most urgent issues are:

1. **Unauthenticated financial endpoints** — anyone can trigger Stripe payouts and view balances
2. **Unauthenticated API key management** — anyone can create/list/revoke API keys for any wallet
3. **Unauthenticated database management** — `/api/setup-db` runs DDL with zero auth
4. **Client-controlled settlement amounts** — users can settle $50 of usage for $0.01
5. **SQL injection via Supabase connector** — raw SQL from AI model passed to user databases
6. **SSRF in attachment/image fetching** — server fetches arbitrary URLs from user input
7. **No Stripe webhook handling** — chargebacks, disputes, and refunds go undetected

---

## CRITICAL Findings (11)

### C-01: Unauthenticated Stripe Payout Endpoint
**File:** `src/app/api/stripe/payout/route.ts:4-62`

The `POST /api/stripe/payout` endpoint has **zero authentication**. Any anonymous internet user can trigger a payout of the platform's entire Stripe balance to the linked bank account. The `amount` and `currency` are accepted directly from the request body.

```typescript
export async function POST(req: NextRequest) {
  const { amount, currency } = await req.json();
  // ... no auth check anywhere ...
  const payout = await stripe.payouts.create({ amount: payoutAmountCents, currency: cur });
```

**Impact:** Complete financial compromise. An attacker can drain the platform's Stripe balance.

---

### C-02: Unauthenticated Stripe Balance Endpoint
**File:** `src/app/api/stripe/balance/route.ts:4-37`

The `GET /api/stripe/balance` endpoint has **zero authentication**. Anyone can view the platform's complete Stripe balance (available funds, pending funds, all currencies) and recent payout history.

**Impact:** Financial information disclosure. Enables reconnaissance before exploiting C-01.

---

### C-03: Unauthenticated Database Schema Management
**File:** `src/app/api/setup-db/route.ts`

The `GET /api/setup-db` endpoint has **zero authentication**. It executes raw SQL statements against the Supabase Management API including `CREATE TABLE`, `ALTER TABLE`, `DELETE FROM`, and `UPDATE`. Line 186 hardcodes: `update meter_users set account_type = 'superadmin' where email = 'a@buxor.co'` — this runs on every invocation. Line 151 deletes production OAuth tokens on every call.

**Impact:** Full database schema manipulation by any unauthenticated caller.

---

### C-04: Unauthenticated API Key Management
**File:** `src/app/api/v1/keys/route.ts:15-120`

All three HTTP methods (GET, POST, DELETE) authenticate solely by an attacker-supplied `walletAddress` parameter. There is **no session check, no signature verification, no proof of wallet ownership**.

- **GET:** Anyone who knows a wallet address can list all API key metadata
- **POST:** Anyone can create API keys for any wallet address and auto-create user records
- **DELETE:** Anyone can revoke API keys for any wallet address

**Impact:** Complete API key compromise for the v1 API.

---

### C-05: Client-Controlled Settlement Amount
**File:** `src/app/api/billing/settle/route.ts:43, 116`

The settlement amount is taken directly from the client request body and used to create the Stripe PaymentIntent with no server-side verification against actual message costs:

```typescript
const { amount, messageIds } = await req.json();
const amountCents = Math.round(amount * 100);
const paymentIntent = await stripe.paymentIntents.create({ amount: amountCents, ... });
```

A user can accumulate $50 of usage, then settle with `amount: 0.01` and the correct `messageIds`, paying 1 cent for $50 of service.

**Impact:** Direct revenue loss. Users can use the service effectively for free.

---

### C-06: SQL Injection via Supabase Connector
**File:** `src/lib/connectors/supabase-connector.ts:28-73`

The `supabaseQuery` function accepts a raw SQL `query` string from the AI model's tool call arguments and passes it directly to the Supabase RPC endpoint with no sanitization:

```typescript
body: JSON.stringify({ query }),  // raw SQL from LLM tool call
```

Via prompt injection, an attacker can execute arbitrary SQL (`DROP TABLE`, data exfiltration) against the user's connected Supabase project. The comment says "read-only" but nothing enforces this.

**Impact:** Arbitrary SQL execution against connected databases.

---

### C-07: SSRF in Attachment/Image Fetching
**Files:** `src/app/api/chat/route.ts:104-131`, `src/lib/fallback.ts:881-889`

User-supplied attachment URLs are fetched server-side with no validation:

```typescript
const imgRes = await fetch(att.url);  // chat/route.ts:105
const pdfRes = await fetch(att.url);  // chat/route.ts:120
```

An attacker can supply internal URLs (e.g., `http://169.254.169.254/latest/meta-data/`, `http://localhost:5432/`) to probe the internal network and cloud metadata services.

**Impact:** Access to cloud metadata services, internal services, and private network resources.

---

### C-08: Unauthenticated Usage Data Exposure
**File:** `src/app/api/v1/usage/route.ts:5-30`

The usage endpoint authenticates solely via a `walletAddress` query parameter with no proof of ownership. Uses `select("*")` exposing all columns.

**Impact:** Information disclosure of usage patterns and cost data for any user.

---

### C-09: IDOR on Payment Method Operations
**Files:** `src/app/api/billing/cards/default/route.ts:12-21`, `src/app/api/billing/cards/[id]/route.ts:15-42`, `src/app/api/billing/confirm/route.ts:13-27`

**cards/default:** Accepts a `paymentMethodId` from the request body and sets it as default without verifying it belongs to the authenticated user's Stripe customer.

**cards/[id] DELETE:** Calls `stripe.paymentMethods.detach(paymentMethodId)` without verifying the payment method belongs to the authenticated user. An attacker can detach another user's payment method.

**confirm:** Retrieves a SetupIntent by ID without verifying the SetupIntent's `customer` matches the authenticated user's Stripe customer.

**Impact:** Cross-user payment method manipulation and card detachment attacks.

---

### C-10: No Stripe Webhook Handling
**Finding:** There is no webhook endpoint anywhere in the codebase. No `constructEvent`, no `WEBHOOK` references.

This means:
- **Chargebacks** go undetected — users can dispute and continue using the service
- **Refunds** from Stripe dashboard are not reflected in settlement history
- **Card declines** after 3D Secure are not tracked
- **Failed payments** after initial success are unhandled

**Impact:** Undetected financial losses from chargebacks, disputes, and reversals.

---

### C-11: Blockchain Private Key Leak Risk
**File:** `src/lib/base.ts:19`

The `METER_SETTLEMENT_PRIVATE_KEY` is loaded at module scope. If this module is inadvertently imported in a client-side bundle (possible given Next.js tree-shaking and the shared `src/lib/` location), the private key leaks to the browser. When the key is absent, mock transaction hashes are generated that look identical to real ones (line 27-30), silently bypassing on-chain settlement.

**Impact:** Potential blockchain key leak. Silent financial integrity bypass.

---

## HIGH Findings (12)

### H-01: Supabase Service Role Key Bypasses All RLS
**File:** `src/lib/supabase.ts:12-17`

`getSupabaseServer()` uses the service role key which bypasses all Row Level Security. The `setRLSContext()` function exists (line 20-22) but is **never called** anywhere. All authorization depends exclusively on application-level `.eq("user_id", ...)` filters.

**Impact:** Any missed user_id filter becomes a cross-tenant data leak.

---

### H-02: PostgREST Filter Injection
**Files:** `src/app/api/artifacts/push/route.ts:38`, `src/app/api/artifacts/route.ts:22`, `src/app/api/decisions/route.ts:49,67`, `src/lib/tools.ts:561-568,657`

User-supplied values are interpolated directly into Supabase `.or()` filter strings:

```typescript
query = query.or(`session_id.eq.${sessionId},project_id.eq.${sessionId}`);
```

A `sessionId` value containing PostgREST metacharacters (e.g., `anything,user_id.neq.X`) could alter the filter logic and bypass user-scoping.

**Impact:** Authorization bypass allowing access to other users' artifacts and decisions.

---

### H-03: Race Condition — Charge Before Ownership Verification
**File:** `src/app/api/billing/settle/route.ts:117-149`

The settlement endpoint creates and confirms the Stripe PaymentIntent **before** verifying message ownership. If ownership check fails on line 143, the payment is already charged with no refund mechanism.

**Impact:** Orphaned charges where money is collected without settlement being recorded.

---

### H-04: No Rate Limiting or Spend Controls on v1 API
**File:** `src/app/api/v1/chat/route.ts:24-192`

Unlike the internal `/api/chat` endpoint, the external v1 API has **no spend limit checks, no rate limiting, and no per-key usage caps**. A single API key can make unlimited requests consuming unlimited upstream credits.

**Impact:** Financial abuse — a single key can drain OpenRouter credits.

---

### H-05: Session Tokens Stored as Plaintext
**File:** `src/lib/session.ts:16-17, 55-58`

Session tokens are stored and looked up as plaintext in the `auth_sessions` table. If the database is compromised, all session tokens are immediately usable for impersonation.

**Impact:** Full account takeover on database compromise.

---

### H-06: No Input Validation on Chat Messages
**Files:** `src/app/api/chat/route.ts:39-42`, `src/app/api/v1/chat/route.ts:33-34`

Neither chat endpoint validates that `messages` is a non-empty array, that roles are valid, that content is within bounds, or that `model` is from an allowed list. System role messages could enable prompt injection.

**Impact:** Prompt injection, denial-of-service via oversized payloads.

---

### H-07: Destructive Operations via GET Request
**File:** `src/app/api/recover-sessions/route.ts:180-527`

The GET handler executes destructive database modifications (moving messages, deleting sessions) when `?confirm=true` is passed. GET requests can be triggered by browser prefetch, crawlers, bookmarks, or extensions.

**Impact:** Data corruption via unintentional triggering.

---

### H-08: Prompt Injection in Debate/Dissect Engines
**Files:** `src/lib/debate.ts:152-158,211-213`, `src/lib/dissect.ts:53-67,70-112`

User conversation content is interpolated directly into system prompts without sanitization:

```typescript
content: `Here's the full debate on "${topic}":\n\n${fullDebateText}...`
```

**Impact:** Model behavior manipulation, unauthorized tool calls, system prompt leakage.

---

### H-09: GitHub Connector Path Traversal
**File:** `src/lib/connectors/github.ts:82,102,129`

The `owner`, `repo`, and `path` parameters from AI tool calls are not validated for path traversal. The `owner/name` split uses a simple `.split("/")` that could be manipulated with crafted input.

**Impact:** Unauthorized access to repositories via path traversal.

---

### H-10: Spend Limits Fail Open
**File:** `src/app/api/chat/route.ts:611,655`

Both `checkSpendLimits` and `checkExposureCap` return `null` (meaning "allow") on any exception. During a database outage, all financial safeguards are silently disabled.

```typescript
} catch {
  return null;  // No error = unlimited spending
}
```

**Impact:** Unlimited spending during database outages.

---

### H-11: Client Controls Cost and Settlement Data
**File:** `src/app/api/sessions/route.ts:198-236,250-270`

The session sync endpoint allows clients to set `total_cost`, `today_cost`, `cost`, `settled`, `receipt_status`, `signature`, and `tx_hash` directly. A user could mark messages as `settled: true` with `cost: 0`.

**Impact:** Financial data manipulation to avoid paying.

---

### H-12: Float Precision Issues in Money Calculations
**Files:** `src/app/api/billing/settle/route.ts:116`, `src/app/api/chat/route.ts:597-605`

All monetary amounts use floating-point arithmetic. `Math.round(amount * 100)` can produce incorrect results (e.g., `Math.round(1.005 * 100) = 100` instead of 101). Spend limit comparisons with floats can fail.

**Impact:** Off-by-one-cent errors, systematic rounding losses, spend limit bypasses.

---

## MEDIUM Findings (15)

### M-01: `per_txn_limit` Enforced Client-Side Only
**File:** `src/app/api/chat/route.ts:578`

Per-transaction spend limits are enforced only in the browser (`chat-view.tsx`), trivially bypassed by calling the API directly.

### M-02: Stored XSS via File Upload
**File:** `src/app/api/attachments/upload/route.ts:42-43`

File extension is extracted from the filename without validation against MIME type. The storage bucket is `public: true` (setup-db:159). An attacker can upload a `.html` or `.svg` file with `image/jpeg` MIME type.

### M-03: Spend Limit Race Condition (TOCTOU)
**File:** `src/app/api/chat/route.ts:44-71,580-614`

Spend limits are checked before request processing. Concurrent requests all pass the check simultaneously, then all proceed beyond the limit.

### M-04: Non-Atomic Account Deletion
**File:** `src/app/api/account/delete/route.ts:61-85`

Sequential deletes without a transaction. If intermediate steps fail, the account is left partially deleted. Stripe customer may be deleted but user record persists.

### M-05: Public Storage Bucket with Guessable Paths
**File:** `src/app/api/attachments/upload/route.ts:43`

Upload paths follow `{userId}/{timestamp}_{4-char-random}.{ext}`. With the bucket set to `public: true`, uploaded files can be enumerated if userId and approximate time are known.

### M-06: Settlement History Writes Silently Fail
**File:** `src/app/api/billing/settle/route.ts:76,190`

Settlement history insert failures are caught with `.then(() => {}, (e) => console.error(...))`. The charge succeeds but no audit record exists.

### M-07: CSP Allows `unsafe-eval` and `unsafe-inline`
**File:** `next.config.ts:7`

The Content Security Policy includes `'unsafe-eval'` and `'unsafe-inline'` for scripts, severely weakening XSS protection.

### M-08: TypeScript and ESLint Errors Ignored in Builds
**File:** `next.config.ts:50-55`

```typescript
typescript: { ignoreBuildErrors: true },
eslint: { ignoreDuringBuilds: true },
```

Type errors that could indicate security bugs are silently ignored in production builds.

### M-09: Wildcard Image Domains
**File:** `next.config.ts:43-49`

Allows Next.js image optimization from ANY domain including HTTP, usable as an open proxy.

### M-10: Ramp Connector Uses Demo API by Default
**File:** `src/lib/connectors/ramp.ts:1`

Production bearer tokens are sent to `demo-api.ramp.com` first, then fall back to production.

### M-11: PostHog API Key Leaked Across Regions
**File:** `src/lib/connectors/posthog.ts:3-25`

If the US endpoint returns any error, the same API key is automatically sent to the EU endpoint.

### M-12: No Domain Registration Idempotency
**File:** `src/app/api/porkbun/register/route.ts:6-41`

Domain registration (real money) has no confirmation step, no duplicate prevention, no rate limiting.

### M-13: SuperAdmin Bypass Insufficient Protection
**File:** `src/app/api/billing/settle/route.ts:53-91`

The `account_type` field lives in the same `meter_users` table. If any code path allows updating profile fields, a user could set themselves as superadmin and use the service for free.

### M-14: Weak ID Generation (Server-Side)
**Files:** `src/lib/tools.ts:484,595`, `src/app/api/billing/settle/route.ts:63,177`

Decision IDs, artifact IDs, and settlement history IDs use `Math.random()` (not cryptographically secure) with limited entropy.

### M-15: No Cleanup of Expired Auth Challenges
**File:** `supabase-schema.sql:35-42`

The `auth_challenges` table has `expires_at` but no background cleanup. Expired challenges accumulate indefinitely.

---

## LOW Findings (14)

### L-01: `debug.log` Committed to Repository
**File:** `debug.log` (16KB)

Contains Privy API responses, verification public keys, allowed domains, WalletConnect project IDs, and internal development URLs. This file is in `.gitignore` but is already committed to the repo.

### L-02: No CSRF Protection
All mutation endpoints rely on `sameSite: "lax"` cookies only. No CSRF tokens anywhere. The `/api/recover-sessions?confirm=true` GET endpoint is particularly vulnerable.

### L-03: No Rate Limiting on Any Endpoint
Zero rate limiting implementation across all ~30 API endpoints. No brute-force protection on auth endpoints.

### L-04: Error Messages Leak Internal Details
Multiple endpoints return raw error messages from Stripe, Supabase, and internal exceptions to clients: `return NextResponse.json({ error: message }, { status: 500 })`.

### L-05: `debug-sessions` Endpoint in Production
**File:** `src/app/api/debug-sessions/route.ts`

Exposes detailed internal session state, message content previews, and complete metadata. Should not exist in production.

### L-06: Stripe Deletion Errors Silently Swallowed
**File:** `src/app/api/account/delete/route.ts:54-59`

If Stripe customer deletion fails (active subscriptions), the error is swallowed and account deletion proceeds.

### L-07: OAuth State Not Verified on Callback
**File:** `src/lib/oauth.ts:77-79`

The `generateState()` function produces a state token but there is no visible storage or verification mechanism for validating it on callback.

### L-08: Porkbun Uses Platform-Level API Keys
**File:** `src/lib/connectors/porkbun.ts:13-19`

Domain operations use platform-level Porkbun credentials, not per-user. Any prompt injection triggering registration charges the platform.

### L-09: No Input Validation on Tool Arguments
**File:** `src/lib/tools.ts:261-403`

All tool arguments are cast with `as string`, `as number` with no schema validation. No Zod or similar validation.

### L-10: Missing Foreign Key on `chat_sessions.user_id`
**File:** `supabase-schema.sql:66`

`chat_sessions.user_id` has no foreign key constraint to `meter_users(id)`, allowing orphaned sessions.

### L-11: No Constraints on `markup_multiplier`
**File:** `supabase-schema.sql:13`

The `markup_multiplier` column has no CHECK constraint — could be set to 0 or negative.

### L-12: Module-Level Rate Limiter Ineffective in Serverless
**File:** `src/lib/connectors/porkbun.ts:24-34`

Uses module-level variables for rate limiting, reset on every cold start in serverless environments.

### L-13: `process.env` Mutation at Runtime
**File:** `src/lib/fallback.ts:91-93`

Mutates `process.env.AWS_BEARER_TOKEN_BEDROCK` at runtime, potential race condition in concurrent requests.

### L-14: No Expired Session Cleanup
**File:** `src/lib/session.ts`

Expired sessions are only cleaned when presented. No background job — stale plaintext tokens accumulate.

---

## Database Schema Issues

| Issue | Location | Severity |
|-------|----------|----------|
| No RLS policies enforced (service role bypasses all) | `supabase.ts:12` | HIGH |
| `setRLSContext()` defined but never called | `supabase.ts:20` | HIGH |
| `chat_sessions.user_id` missing FK constraint | `schema.sql:66` | LOW |
| `markup_multiplier` has no CHECK constraint | `schema.sql:13` | LOW |
| `settlement_history.status` has no CHECK constraint | `schema.sql:216` | LOW |
| No background cleanup for `auth_challenges` | `schema.sql:35` | LOW |
| OAuth tokens encrypted at rest (good) | `oauth.ts:54-62` | POSITIVE |

---

## Systemic Issues

### Zero Rate Limiting
No endpoint implements rate limiting — not auth, not billing, not chat, not API key management. This enables brute-force, credential stuffing, and resource exhaustion attacks.

### Zero CSRF Protection
No CSRF tokens anywhere. Relies solely on `sameSite: "lax"` cookies, which do not protect GET-based mutations (like `/api/recover-sessions?confirm=true`).

### Fail-Open Pattern
Financial safety checks (`checkSpendLimits`, `checkExposureCap`) silently return "allow" on any exception. The system should fail closed for financial controls.

### No Webhook Infrastructure
Without Stripe webhooks, the system has no way to learn about asynchronous payment events (disputes, refunds, failures). This is a fundamental architectural gap for a billing system.

---

## Priority Remediation Order

| Priority | Finding | Effort | Impact |
|----------|---------|--------|--------|
| **P0 — Immediate** | C-01, C-02: Add auth to stripe/balance and stripe/payout | Low | Financial drain |
| **P0 — Immediate** | C-03: Add auth to /api/setup-db or remove entirely | Low | DB compromise |
| **P0 — Immediate** | C-04: Add proper auth to /api/v1/keys | Medium | API key takeover |
| **P0 — Immediate** | C-05: Verify settlement amounts server-side | Medium | Revenue loss |
| **P0 — Immediate** | C-07: Validate/allowlist attachment URLs | Low | SSRF |
| **P1 — This week** | C-06: Sandbox/allowlist Supabase connector queries | Medium | SQL injection |
| **P1 — This week** | C-09: Verify payment method ownership | Medium | Cross-user billing |
| **P1 — This week** | C-10: Implement Stripe webhook handler | High | Chargeback loss |
| **P1 — This week** | H-01: Enforce RLS or add user_id checks audit | High | Data leaks |
| **P1 — This week** | H-02: Parameterize .or() filters | Medium | Auth bypass |
| **P1 — This week** | H-04: Add spend limits to v1 API | Medium | Financial abuse |
| **P1 — This week** | H-05: Hash session tokens before storage | Low | Account takeover |
| **P2 — This sprint** | H-11: Prevent client from setting financial fields | Medium | Billing manipulation |
| **P2 — This sprint** | H-12: Use integer cents for all money math | Medium | Rounding errors |
| **P2 — This sprint** | L-03: Add rate limiting to all endpoints | Medium | Abuse prevention |
| **P2 — This sprint** | M-02: Validate upload extensions against MIME | Low | Stored XSS |
| **P3 — Backlog** | M-07: Remove unsafe-eval from CSP | Medium | XSS hardening |
| **P3 — Backlog** | M-08: Enable TypeScript/ESLint checking in builds | Low | Bug prevention |
| **P3 — Backlog** | L-01: Remove debug.log from git history | Low | Info disclosure |

---

*End of audit report.*
