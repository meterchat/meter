# Security Audit Report

**Date:** 2026-02-23
**Scope:** Full codebase review of `/workspace` (Meter application)
**Auditor:** Automated Security Review

---

## Executive Summary

This audit identified **34 security findings** across the codebase, including **6 CRITICAL**, **13 HIGH**, **11 MEDIUM**, and **4 LOW** severity issues. The most severe issues involve unauthenticated access to financial endpoints (Stripe balance/payouts), missing authorization checks enabling IDOR attacks, absent Row Level Security on the database, and no rate limiting on authentication endpoints.

---

## CRITICAL Findings

### C-1: Unauthenticated Stripe Balance Endpoint

- **File:** `src/app/api/stripe/balance/route.ts`
- **Lines:** 4-37
- **Category:** Authentication Bypass
- **Description:** The `/api/stripe/balance` GET endpoint exposes the platform's entire Stripe balance (available and pending funds) and recent payout history without any authentication. Any unauthenticated user or bot can query this endpoint to see the platform's financial position.

```typescript
export async function GET() {
  try {
    const [balance, payouts] = await Promise.all([
      stripe.balance.retrieve(),
      stripe.payouts.list({ limit: 10 }),
    ]);
    // ... returns all balance data ...
  }
}
```

### C-2: Unauthenticated Stripe Payout Endpoint

- **File:** `src/app/api/stripe/payout/route.ts`
- **Lines:** 4-62
- **Category:** Authentication Bypass
- **Description:** The `/api/stripe/payout` POST endpoint allows anyone to trigger payouts from the platform's Stripe account without any authentication. An attacker can drain the platform's Stripe balance by repeatedly calling this endpoint.

```typescript
export async function POST(req: NextRequest) {
  try {
    const { amount, currency } = await req.json();
    // No auth check — anyone can trigger a payout
    const payout = await stripe.payouts.create({
      amount: payoutAmountCents,
      currency: cur,
      description: "Meter platform payout",
    });
  }
}
```

### C-3: Unauthenticated Database Migration Endpoint with Hardcoded Superadmin

- **File:** `src/app/api/setup-db/route.ts`
- **Lines:** 198, 153
- **Category:** Authentication Bypass, Hardcoded Credentials
- **Description:** The `/api/setup-db` GET endpoint has no authentication and executes database schema migrations. It also contains a hardcoded statement that promotes `a@buxor.co` to superadmin. Anyone can invoke this endpoint to re-run migrations or trigger the superadmin promotion.

```typescript
// Line 153: Hardcoded superadmin promotion
`update meter_users set account_type = 'superadmin' where email = 'a@buxor.co' and account_type = 'standard'`,

// Line 198: No authentication
export async function GET() {
```

### C-4: No Row Level Security (RLS) on Supabase Tables

- **File:** `supabase-schema.sql` (entire file)
- **File:** `src/lib/supabase.ts`, lines 4-9
- **Category:** Authorization Issue, Data Exposure
- **Description:** No RLS policies are defined on any database table. The browser client (`getSupabaseBrowser`) uses the anon key which is publicly exposed via `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Without RLS, anyone with the anon key (extractable from the frontend JavaScript bundle) can directly read and write ALL tables including `meter_users`, `auth_sessions`, `oauth_tokens`, `settlement_history`, `passkey_credentials`, and more. This completely bypasses all server-side access control.

```typescript
// Browser client — uses anon key, respects RLS
export function getSupabaseBrowser() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  // Without RLS policies, anon key has FULL access to all tables
  return createClient(url, key);
}
```

### C-5: V1 API Keys Endpoint — No Authentication, No Authorization

- **File:** `src/app/api/v1/keys/route.ts`
- **Lines:** 15-105
- **Category:** Authentication Bypass, IDOR
- **Description:** All three HTTP methods (GET, POST, DELETE) have no authentication. GET and POST only require a `walletAddress` parameter (public information). DELETE only requires a key `id` with no ownership verification — any user can revoke any other user's API key.

```typescript
// GET — anyone can list keys for any wallet
export async function GET(req: NextRequest) {
  const walletAddress = req.nextUrl.searchParams.get("walletAddress");
  // No auth — returns all keys for the wallet
}

// DELETE — anyone can revoke any key by ID
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  // No auth, no ownership check
  await supabase.from("api_keys").update({ active: false }).eq("id", id);
}
```

### C-6: No Rate Limiting on Authentication Endpoints

- **File:** `src/app/api/auth/login/route.ts`
- **File:** `src/app/api/auth/register/route.ts`
- **File:** `src/app/api/auth/check/route.ts`
- **Category:** Missing Rate Limiting
- **Description:** No rate limiting exists on any authentication endpoint. This enables unlimited brute-force attempts, mass user enumeration via `/api/auth/check`, and denial of service through resource exhaustion (each request triggers database lookups and WebAuthn operations).

---

## HIGH Findings

### H-1: V1 Usage Endpoint — No Authentication

- **File:** `src/app/api/v1/usage/route.ts`
- **Lines:** 5-30
- **Category:** Authentication Bypass
- **Description:** The `/api/v1/usage` GET endpoint returns usage records for any wallet address without authentication. Exposes model usage patterns, token counts, and timestamps.

```typescript
export async function GET(req: NextRequest) {
  const walletAddress = req.nextUrl.searchParams.get("walletAddress");
  // No auth — anyone can view usage for any wallet
}
```

### H-2: Payment Method Detach Without Ownership Verification

- **File:** `src/app/api/billing/cards/[id]/route.ts`
- **Line:** 42
- **Category:** IDOR, Authorization Issue
- **Description:** The DELETE endpoint calls `stripe.paymentMethods.detach(paymentMethodId)` where `paymentMethodId` comes from the URL path. While the code lists the authenticated user's payment methods to check count, it does not verify that the payment method being detached actually belongs to the authenticated user's Stripe customer. An attacker could detach another user's payment method by supplying their payment method ID.

```typescript
// paymentMethodId comes from URL — not verified against customer
await stripe.paymentMethods.detach(paymentMethodId);
```

### H-3: SetupIntent Ownership Not Verified

- **File:** `src/app/api/billing/confirm/route.ts`
- **Lines:** 21-42
- **Category:** IDOR, Authorization Issue
- **Description:** The `setupIntentId` comes from the request body and is used to retrieve and process a SetupIntent. The code does not verify the SetupIntent belongs to the authenticated user's Stripe customer. An attacker could use another user's completed SetupIntent ID to associate a payment method with a different account.

```typescript
const { setupIntentId } = await req.json();
// No verification that this SetupIntent belongs to the authenticated user
const setupIntent = await stripe.setupIntents.retrieve(setupIntentId, {
  expand: ["payment_method"],
});
```

### H-4: Default Payment Method Ownership Not Verified

- **File:** `src/app/api/billing/cards/default/route.ts`
- **Lines:** 12-19
- **Category:** IDOR, Authorization Issue
- **Description:** The `paymentMethodId` comes from the request body and is set as the default payment method without verifying it belongs to the authenticated user's Stripe customer.

```typescript
const { paymentMethodId } = await req.json();
// No ownership verification
await stripe.customers.update(customerId, {
  invoice_settings: { default_payment_method: paymentMethodId },
});
```

### H-5: Settlement Message IDs Not Ownership-Checked

- **File:** `src/app/api/billing/settle/route.ts`
- **Lines:** 107-112
- **Category:** IDOR, Authorization Issue
- **Description:** The `messageIds` array from the request body is used to mark messages as settled without verifying those messages belong to the authenticated user's sessions. An attacker could mark other users' messages as settled, preventing them from being charged.

```typescript
if (messageIds && messageIds.length > 0) {
  await supabase
    .from("chat_messages")
    .update({ settled: true, receipt_status: "settled" })
    .in("id", messageIds);  // No user ownership check
}
```

### H-6: Settlement Amount Client-Controlled

- **File:** `src/app/api/billing/settle/route.ts`
- **Line:** 17
- **Category:** Missing Input Validation, Business Logic
- **Description:** The `amount` for the Stripe charge comes directly from the client request body. While a positive value is required, there is no server-side calculation or verification that the amount matches the actual cost of the messages being settled. A malicious user could underpay by sending a lower amount while marking all messages as settled.

```typescript
const { stripeCustomerId, workspaceId, amount, messageIds, chargeIds } = await req.json();
// amount is client-controlled — no server-side recalculation
const amountCents = Math.round(amount * 100);
```

### H-7: User Enumeration via Auth Check

- **File:** `src/app/api/auth/check/route.ts`
- **Lines:** 30-33
- **Category:** Information Disclosure
- **Description:** Returns whether an email address exists in the system, whether the user has passkeys registered, and the internal user ID — all to unauthenticated callers. This enables targeted attacks against known users.

```typescript
return NextResponse.json({
  exists: true,
  hasPasskey: (creds ?? []).length > 0,
  userId: user.id,  // Internal user ID leaked
});
```

### H-8: User ID Leaked During Login Options Step

- **File:** `src/app/api/auth/login/route.ts`
- **Line:** 71
- **Category:** Information Disclosure
- **Description:** The login options step returns the internal `userId` before authentication is complete. Combined with H-7, an attacker can enumerate user IDs for any email address.

```typescript
return NextResponse.json({ options, challengeId, userId: user.id });
```

### H-9: Raw Error Messages Returned to Client

- **File:** `src/app/api/auth/login/route.ts`, lines 162-168
- **File:** `src/app/api/auth/register/route.ts`, lines 164-170
- **File:** `src/app/api/account/delete/route.ts`, line 90
- **File:** `src/app/api/billing/settle/route.ts`, line 176
- **File:** `src/app/api/stripe/balance/route.ts`, line 35
- **Category:** Information Disclosure
- **Description:** Multiple endpoints return raw error messages to the client. These messages can include database column names, table names, Supabase error details, and Stripe API errors that reveal internal architecture details.

```typescript
return NextResponse.json({ error: message }, { status: 500 });
```

### H-10: No Rate Limiting on Chat/API Endpoints

- **File:** `src/app/api/chat/route.ts`
- **File:** `src/app/api/v1/chat/route.ts`
- **Category:** Missing Rate Limiting
- **Description:** No request-count rate limiting exists on chat endpoints. While spend limits provide some cost control, they don't prevent rapid bursts of requests that could exhaust upstream API quotas or cause denial of service.

### H-11: Session Token Stored in Plaintext

- **File:** `src/lib/session.ts`, line 16
- **File:** `supabase-schema.sql`, line 224
- **Category:** Insecure Session Management
- **Description:** Session tokens are stored as the primary key of the `auth_sessions` table in plaintext. If the database is compromised (especially given C-4 — no RLS), an attacker gains all active session tokens and can impersonate any user. Best practice is to hash session tokens before storage (like the API key approach in `v1/keys`).

```typescript
const { error } = await supabase.from("auth_sessions").insert({
  token,  // Stored in plaintext as primary key
  user_id: userId,
  expires_at: expiresAt.toISOString(),
});
```

### H-12: No Email Format Validation on Registration

- **File:** `src/app/api/auth/register/route.ts`, line 30
- **File:** `src/app/api/auth/login/route.ts`, line 27
- **Category:** Missing Input Validation
- **Description:** Email input is only lowercased and trimmed, with no format validation. This could allow invalid entries in the database and potentially enable injection or abuse scenarios.

```typescript
const normalizedEmail = email.toLowerCase().trim();
// No format validation — could be empty string, SQL-like content, etc.
```

### H-13: CSP Allows unsafe-eval and unsafe-inline

- **File:** `next.config.ts`, lines 5-6
- **Category:** XSS Vector
- **Description:** The Content Security Policy includes both `'unsafe-eval'` and `'unsafe-inline'` in the `script-src` directive. This significantly weakens XSS protections, allowing inline script injection and eval-based attacks. Nonce-based or hash-based CSP should be used instead.

```typescript
script-src 'self' 'unsafe-eval' 'unsafe-inline' https://js.stripe.com;
```

---

## MEDIUM Findings

### M-1: Wildcard Image Remote Patterns

- **File:** `next.config.ts`, lines 33-36
- **Category:** SSRF, Content Injection
- **Description:** The `remotePatterns` configuration allows images from any hostname and any protocol (including HTTP). This could enable SSRF attacks or allow serving malicious content through the image optimization proxy.

```typescript
images: {
  remotePatterns: [
    { protocol: 'https', hostname: '**' },
    { protocol: 'http', hostname: '**' },
  ],
},
```

### M-2: TypeScript and ESLint Errors Ignored in Build

- **File:** `next.config.ts`, lines 38-41
- **Category:** Security Process
- **Description:** Both TypeScript errors and ESLint errors are ignored during builds. Security-relevant type errors and lint warnings (such as unused variables containing secrets, type confusion, etc.) will not prevent deployment.

```typescript
typescript: { ignoreBuildErrors: true },
eslint: { ignoreDuringBuilds: true },
```

### M-3: 30-Day Session TTL Without Rotation

- **File:** `src/lib/session.ts`, line 7
- **Category:** Insecure Session Management
- **Description:** Sessions have a 30-day TTL with no rotation mechanism. If a session token is stolen, the attacker has up to 30 days of access. Implementing session rotation (issuing a new token periodically or on sensitive actions) would limit the window of exposure.

### M-4: Sessions POST — Insufficient Input Validation

- **File:** `src/app/api/sessions/route.ts`, lines 119-189
- **Category:** Missing Input Validation
- **Description:** The session sync endpoint accepts client-provided values for `totalCost`, `todayCost`, `todayTokensIn`, `todayTokensOut`, and `todayMessageCount` without server-side validation. A malicious client could manipulate cost tracking by sending false values.

```typescript
const { error: sessErr } = await supabase.from("chat_sessions").upsert({
  total_cost: session.totalCost ?? 0,    // Client-controlled
  today_cost: session.todayCost ?? 0,    // Client-controlled
  today_tokens_in: session.todayTokensIn ?? 0,
  // ...
});
```

### M-5: Settlement History Records Use Weak IDs

- **File:** `src/app/api/billing/settle/route.ts`, line 139
- **Category:** Insecure Crypto Practices
- **Description:** Settlement history IDs are generated using `Date.now().toString(36)` and `Math.random()`. `Math.random()` is not cryptographically secure, making IDs partially predictable.

```typescript
const historyId = `stl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
```

### M-6: Hardcoded Superadmin Email in Schema

- **File:** `supabase-schema.sql`, line 242
- **Category:** Hardcoded Credentials
- **Description:** The schema contains a commented-out SQL statement to promote a specific email to superadmin. While commented out, this exposes the superadmin account identity in the repository.

```sql
-- update meter_users set account_type = 'superadmin' where email = 'a@buxor.co';
```

### M-7: OAuth Callback Missing Session Authentication

- **File:** `src/app/api/oauth/[provider]/callback/route.ts`, lines 12-79
- **Category:** Authentication Bypass
- **Description:** The OAuth callback endpoint does not verify the current user's session. It relies entirely on the `user_id` from the `oauth_state` record. If an attacker can predict or intercept the state parameter, they could associate an OAuth token with another user's account. While the state is cryptographically random (32 bytes), the lack of session verification as a defense-in-depth measure is a concern.

### M-8: Base Settlement Private Key Fallback to Mock

- **File:** `src/lib/base.ts`, lines 27-31
- **Category:** Business Logic, Security Configuration
- **Description:** When `METER_SETTLEMENT_PRIVATE_KEY` is not set, the settlement function returns a mock transaction hash instead of failing. In production, this could silently skip blockchain settlement while reporting success.

```typescript
if (!SETTLEMENT_PRIVATE_KEY) {
  console.warn("METER_SETTLEMENT_PRIVATE_KEY not set, generating mock tx hash");
  const mockHash = `0x${Array.from({ length: 64 }, () =>
    Math.floor(Math.random() * 16).toString(16)).join("")}`;
  return mockHash;
}
```

### M-9: WebAuthn requireUserVerification Set to False

- **File:** `src/app/api/auth/login/route.ts`, line 109
- **File:** `src/app/api/auth/register/route.ts`, line 112
- **Category:** Authentication Weakness
- **Description:** Both login and registration set `requireUserVerification: false`, meaning biometric/PIN verification on the authenticator is not enforced. This weakens the security guarantee of passkey authentication — a stolen hardware key could be used without additional verification.

```typescript
const verification = await verifyAuthenticationResponse({
  // ...
  requireUserVerification: false,
});
```

### M-10: Expired Auth Challenges Not Cleaned Up Proactively

- **File:** `src/app/api/auth/login/route.ts`, `src/app/api/auth/register/route.ts`
- **Category:** Resource Exhaustion
- **Description:** Auth challenges are only cleaned up when they are successfully used. Expired challenges accumulate in the `auth_challenges` table indefinitely. An attacker could flood the table by repeatedly requesting options without completing verification.

### M-11: Missing DEEPSEEK_API_KEY and XAI_API_KEY in .env.example

- **File:** `.env.example`
- **File:** `src/lib/fallback.ts`, lines 58-63
- **Category:** Security Configuration
- **Description:** The `.env.example` file is missing documentation for `DEEPSEEK_API_KEY`, `XAI_API_KEY` (partially present), `METER_SETTLEMENT_PRIVATE_KEY`, and `BASE_RPC_URL`. This could lead to accidental exposure if these are set elsewhere without proper access controls.

---

## LOW Findings

### L-1: Default RP_ID and APP_URL Hardcoded

- **File:** `src/app/api/auth/login/route.ts`, lines 10-11
- **File:** `src/app/api/auth/register/route.ts`, lines 11-12
- **Category:** Hardcoded Configuration
- **Description:** Default values for WebAuthn RP_ID (`"meter.chat"`) and APP_URL (`"https://meter.chat"`) are hardcoded. If environment variables are misconfigured, the application silently falls back to production values, which could cause auth issues in other environments.

### L-2: OAuth Token Encryption Implementation

- **File:** `src/lib/oauth.ts`, lines 70-98
- **Category:** Cryptographic Note (Positive)
- **Description:** Token encryption uses AES-256-GCM with random IVs and proper auth tag handling. This is correctly implemented. However, key rotation is not supported — changing `OAUTH_TOKEN_SECRET` invalidates all stored tokens without a migration path.

### L-3: API Key Hash Uses SHA-256 Without Salt

- **File:** `src/app/api/v1/keys/route.ts`, line 11
- **Category:** Insecure Crypto Practices
- **Description:** API key hashing uses plain SHA-256 without a salt. While API keys have high entropy (24 random bytes), adding a salt would provide defense-in-depth against precomputation attacks.

```typescript
function hashKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex");
}
```

### L-4: Middleware Does Not Enforce Auth

- **File:** `src/middleware.ts`
- **Category:** Architecture Note
- **Description:** The middleware only handles hostname-based routing and does not enforce authentication at the middleware level. All auth enforcement is deferred to individual route handlers, making it easy to forget auth checks on new routes (as evidenced by C-1, C-2, C-3, C-5, H-1).

---

## Summary Table

| ID | Severity | Category | File | Description |
|----|----------|----------|------|-------------|
| C-1 | CRITICAL | Auth Bypass | stripe/balance/route.ts | Unauthenticated Stripe balance exposure |
| C-2 | CRITICAL | Auth Bypass | stripe/payout/route.ts | Unauthenticated Stripe payout trigger |
| C-3 | CRITICAL | Auth Bypass | setup-db/route.ts | Unauthenticated DB migration + hardcoded superadmin |
| C-4 | CRITICAL | Authorization | supabase-schema.sql | No RLS policies — anon key has full DB access |
| C-5 | CRITICAL | Auth Bypass | v1/keys/route.ts | Unauthenticated key management + no ownership check |
| C-6 | CRITICAL | Rate Limiting | auth/*/route.ts | No rate limiting on auth endpoints |
| H-1 | HIGH | Auth Bypass | v1/usage/route.ts | Unauthenticated usage data access |
| H-2 | HIGH | IDOR | billing/cards/[id]/route.ts | Payment method detach without ownership check |
| H-3 | HIGH | IDOR | billing/confirm/route.ts | SetupIntent ownership not verified |
| H-4 | HIGH | IDOR | billing/cards/default/route.ts | Default payment method ownership not verified |
| H-5 | HIGH | IDOR | billing/settle/route.ts | Message IDs not ownership-checked |
| H-6 | HIGH | Input Validation | billing/settle/route.ts | Settlement amount client-controlled |
| H-7 | HIGH | Info Disclosure | auth/check/route.ts | User enumeration + internal ID leak |
| H-8 | HIGH | Info Disclosure | auth/login/route.ts | User ID leaked pre-authentication |
| H-9 | HIGH | Info Disclosure | Multiple files | Raw error messages returned to client |
| H-10 | HIGH | Rate Limiting | chat/route.ts, v1/chat/route.ts | No rate limiting on chat endpoints |
| H-11 | HIGH | Session Mgmt | session.ts | Session tokens stored in plaintext |
| H-12 | HIGH | Input Validation | auth/register/route.ts | No email format validation |
| H-13 | HIGH | XSS | next.config.ts | CSP allows unsafe-eval and unsafe-inline |
| M-1 | MEDIUM | SSRF | next.config.ts | Wildcard image remote patterns |
| M-2 | MEDIUM | Process | next.config.ts | Build errors ignored |
| M-3 | MEDIUM | Session Mgmt | session.ts | 30-day TTL without rotation |
| M-4 | MEDIUM | Input Validation | sessions/route.ts | Client-controlled cost values |
| M-5 | MEDIUM | Crypto | billing/settle/route.ts | Math.random() for IDs |
| M-6 | MEDIUM | Hardcoded | supabase-schema.sql | Superadmin email in schema |
| M-7 | MEDIUM | Auth | oauth/callback/route.ts | No session check in OAuth callback |
| M-8 | MEDIUM | Config | base.ts | Mock settlement when key missing |
| M-9 | MEDIUM | Auth | auth/login+register/route.ts | User verification not required |
| M-10 | MEDIUM | DoS | auth/login+register/route.ts | Expired challenges not cleaned up |
| M-11 | MEDIUM | Config | .env.example | Missing env var documentation |
| L-1 | LOW | Config | auth/login+register/route.ts | Hardcoded default RP_ID/APP_URL |
| L-2 | LOW | Crypto | oauth.ts | No key rotation support (positive note) |
| L-3 | LOW | Crypto | v1/keys/route.ts | SHA-256 without salt |
| L-4 | LOW | Architecture | middleware.ts | No auth enforcement at middleware level |

---

## Recommended Priority Actions

1. **Immediately** add authentication to `/api/stripe/balance`, `/api/stripe/payout`, and `/api/setup-db` (C-1, C-2, C-3)
2. **Immediately** add RLS policies to all Supabase tables or restrict the anon key's access (C-4)
3. **Immediately** add authentication and ownership checks to `/api/v1/keys` and `/api/v1/usage` (C-5, H-1)
4. **Urgently** implement rate limiting on auth endpoints using middleware or a rate-limiting library (C-6)
5. **Urgently** verify Stripe resource ownership before detach/update operations (H-2, H-3, H-4)
6. **Urgently** validate message ownership in settlement and recalculate amounts server-side (H-5, H-6)
7. Hash session tokens before database storage (H-11)
8. Restrict CSP by removing `unsafe-eval` and `unsafe-inline` (H-13)
9. Implement middleware-level auth enforcement as defense-in-depth (L-4)
