# Security Review: PRs #13–#40

## Summary

Reviewed 28 pull requests (PRs #13 through #40) for security vulnerabilities. Found **31 security findings** across 8 PRs, including **3 CRITICAL**, **10 HIGH**, **12 MEDIUM**, and **6 LOW** severity issues. The most pervasive issue is a complete absence of server-side authentication on API endpoints — the application relies entirely on client-side state for auth, meaning every API endpoint that accepts a `userId` parameter is vulnerable to impersonation and cross-account data leakage.

---

## CRITICAL Findings

### 1. PR #29 — IDOR: Unauthenticated Session Read via `GET /api/sessions`

**Severity:** CRITICAL  
**File:** `src/app/api/sessions/route.ts`  
**Description:** The sessions endpoint accepts a `userId` query parameter with absolutely no authentication or authorization check. Any attacker can read any user's complete chat history, token costs, and message content simply by guessing or enumerating user IDs.

```typescript
export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get("userId");
  if (!userId) {
    return NextResponse.json({ error: "Missing userId" }, { status: 400 });
  }
  // NO AUTHENTICATION CHECK — any userId can be queried
  const { data: sessions } = await supabase
    .from("chat_sessions")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
```

### 2. PR #29 — IDOR: Unauthenticated Session Write via `POST /api/sessions`

**Severity:** CRITICAL  
**File:** `src/app/api/sessions/route.ts`  
**Description:** The session save endpoint accepts `userId` from the request body with no authentication. An attacker can overwrite any user's chat sessions and inject arbitrary message content.

```typescript
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { userId, session, messages } = body;
    // NO AUTHENTICATION — attacker can write to any user's sessions
    const { error: sessErr } = await supabase.from("chat_sessions").upsert(
      {
        id: session.id,
        user_id: userId,
        // ...
      },
      { onConflict: "id" }
    );
```

### 3. PR #32 + #33 — No Server-Side Authentication on Any API Route

**Severity:** CRITICAL  
**Description:** The entire application has NO server-side session management. Authentication is stored exclusively in a client-side Zustand store persisted to `localStorage`. There are no JWTs, session cookies, or server-side session tokens. Every API endpoint that accepts a `userId` (sessions, OAuth, billing, tools) can be called by any unauthenticated client. The WebAuthn passkey flow in PR #32 authenticates the user during registration/login but produces no session token — after the passkey ceremony, the server has no way to verify subsequent requests.

**Affected files:**
- `src/app/api/sessions/route.ts`
- `src/app/api/chat/route.ts`
- `src/app/api/oauth/*/route.ts`
- `src/app/api/billing/*/route.ts`
- `src/app/api/v1/keys/route.ts`
- `src/app/api/v1/usage/route.ts`

---

## HIGH Findings

### 4. PR #32 — User Enumeration via `POST /api/auth/check`

**Severity:** HIGH  
**File:** `src/app/api/auth/check/route.ts`  
**Description:** The auth check endpoint returns whether a user exists for a given email address, enabling user enumeration attacks.

```typescript
export async function POST(req: NextRequest) {
  // ...
  return NextResponse.json({
    exists: !!user,
    userId: user.id,  // Leaks the user ID too!
  });
```

### 5. PR #32 — No Rate Limiting on Auth Endpoints

**Severity:** HIGH  
**Files:** `src/app/api/auth/register/route.ts`, `src/app/api/auth/login/route.ts`, `src/app/api/auth/check/route.ts`  
**Description:** None of the authentication endpoints implement rate limiting. An attacker can spam registration to create unlimited accounts, brute-force the login flow, or enumerate users via the check endpoint without any throttling.

### 6. PR #33 — Unauthenticated Database Setup Endpoint

**Severity:** HIGH  
**File:** `src/app/api/setup-db/route.ts`  
**Description:** The `GET /api/setup-db` endpoint runs DDL statements against the database with no authentication. While the statements use `CREATE TABLE IF NOT EXISTS`, this endpoint should never be publicly accessible.

```typescript
export async function GET() {
  // NO AUTHENTICATION CHECK
  // Executes DDL against the production database
  const SCHEMA_SQL = `
    create table if not exists meter_users (...)
    create table if not exists passkey_credentials (...)
    ...
  `;
```

### 7. PR #39 — IDOR: Unauthenticated OAuth Status Check

**Severity:** HIGH  
**File:** `src/app/api/oauth/status/route.ts`  
**Description:** Anyone can check which third-party services any user has connected by providing their userId.

```typescript
export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get("userId");
  // NO AUTHENTICATION
  const status = await getConnectionStatus(userId);
  return NextResponse.json(status);
}
```

### 8. PR #39 — IDOR: Unauthenticated Service Disconnect

**Severity:** HIGH  
**File:** `src/app/api/oauth/[provider]/disconnect/route.ts`  
**Description:** Any attacker can disconnect another user's OAuth-linked services by sending a POST with their userId.

```typescript
export async function POST(req: NextRequest) {
  const { userId } = await req.json();
  // NO AUTHENTICATION — attacker can disconnect any user's services
  await deleteToken(userId, providerId);
```

### 9. PR #39 — IDOR: Unauthenticated API Key Storage

**Severity:** HIGH  
**File:** `src/app/api/oauth/api-key/route.ts`  
**Description:** Any attacker can store arbitrary API keys for another user's account.

```typescript
export async function POST(req: NextRequest) {
  const { userId, provider, apiKey } = await req.json();
  // NO AUTHENTICATION — attacker can write API keys to any user's account
  await storeApiKey(userId, provider, apiKey);
```

### 10. PR #39 — IDOR: Unauthenticated OAuth Flow Initiation

**Severity:** HIGH  
**File:** `src/app/api/oauth/[provider]/authorize/route.ts`  
**Description:** Anyone can initiate an OAuth flow that, upon completion, will link the resulting token to another user's account.

```typescript
export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get("userId");
  // NO AUTHENTICATION — OAuth token will be linked to this userId
  await supabase.from("oauth_state").insert({
    user_id: userId,
    // ...
  });
```

### 11. PR #35 — User Impersonation via Client-Supplied userId in Chat

**Severity:** HIGH  
**File:** `src/app/api/chat/route.ts`  
**Description:** The chat endpoint accepts `userId` and `projectId` from the request body and passes them directly to tool execution (save_decision, list_decisions). An attacker can impersonate any user when interacting with tools.

```typescript
const { messages, model, userId, projectId } = await req.json();
// userId is trusted from the client with no verification
const result = await executeTool(tc.name, args, { userId, projectId });
```

### 12. PR #29 — IDOR: Unauthenticated API Key Management

**Severity:** HIGH  
**File:** `src/app/api/v1/keys/route.ts`  
**Description:** API key CRUD endpoints use `walletAddress` from query params/body with no authentication. Anyone can list, create, or delete API keys for any wallet address.

```typescript
export async function GET(req: NextRequest) {
  const walletAddress = req.nextUrl.searchParams.get("walletAddress");
  // NO AUTHENTICATION
  const { data } = await supabase
    .from("api_keys")
    .select("id, key_prefix, name, active, created_at, last_used_at")
    .eq("user_id", user.id);
```

### 13. PR #29 — IDOR: Unauthenticated Usage Data Access

**Severity:** HIGH  
**File:** `src/app/api/v1/usage/route.ts`  
**Description:** Usage records for any wallet can be retrieved without authentication.

```typescript
export async function GET(req: NextRequest) {
  const walletAddress = req.nextUrl.searchParams.get("walletAddress");
  // NO AUTHENTICATION
```

---

## MEDIUM Findings

### 14. PR #13 — CSP allows `unsafe-eval` and `unsafe-inline` in script-src

**Severity:** MEDIUM  
**File:** `next.config.ts`  
**Description:** The Content Security Policy includes `'unsafe-eval' 'unsafe-inline'` in `script-src`, which significantly weakens XSS protections.

```typescript
const csp = `
  script-src 'self' 'unsafe-eval' 'unsafe-inline';
```

### 15. PR #13 — Wildcard Image Remote Patterns

**Severity:** MEDIUM  
**File:** `next.config.ts`  
**Description:** Both HTTP and HTTPS with wildcard hostnames are allowed for remote images, which can be used for tracking pixels or SSRF via image loading.

```typescript
images: {
  remotePatterns: [
    { protocol: 'https', hostname: '**' },
    { protocol: 'http', hostname: '**' },
  ],
},
```

### 16. PR #16 — Sensitive Auth State Persisted to localStorage

**Severity:** MEDIUM  
**File:** `src/lib/store.ts`  
**Description:** Authentication state (`userId`, `email`, `authenticated`, `cardOnFile`) is persisted to `localStorage`. This data is accessible to any JavaScript running on the same origin, including XSS payloads.

```typescript
partialize: (s) => ({
  userId: s.userId,
  email: s.email,
  authenticated: s.authenticated,
  cardOnFile: s.cardOnFile,
  // ...
}),
```

### 17. PR #29 — Session Sync via sendBeacon Has No Auth

**Severity:** MEDIUM  
**File:** `src/lib/use-session-sync.ts`  
**Description:** The `beforeunload` handler uses `navigator.sendBeacon()` which cannot include authentication headers. Combined with the unauthenticated POST endpoint, this means session data is sent without any auth validation.

```typescript
const handleBeforeUnload = () => {
  const body = JSON.stringify({ userId, session, messages });
  navigator.sendBeacon("/api/sessions", body);
  // sendBeacon cannot set custom headers
};
```

### 18. PR #33 — Internal Error Details Leaked to Client

**Severity:** MEDIUM  
**Files:** `src/app/api/auth/*/route.ts`, `src/app/api/billing/*/route.ts`  
**Description:** Raw error messages are passed to the client, potentially revealing database schema details and internal implementation.

```typescript
const message = err instanceof Error ? err.message : String(err);
return NextResponse.json(
  { error: message.includes("relation") ? "Database tables not set up." : message },
  { status: 500 }
);
```

### 19. PR #35 — Anonymous User Data Sharing via Shared Fallback ID

**Severity:** MEDIUM  
**File:** `src/lib/tools.ts`  
**Description:** When `userId` is not provided, decisions are stored under `"anonymous"`, meaning all unauthenticated users share the same decision space and can read each other's data.

```typescript
async function saveDecision(args, ctx) {
  await supabase.from("decisions").insert({
    user_id: ctx.userId || "anonymous",
    // All unauthenticated users share the "anonymous" namespace
  });
}
```

### 20. PR #37 — Client Controls Tool Availability

**Severity:** MEDIUM  
**File:** `src/app/api/chat/route.ts`  
**Description:** The `connectedServices` array is passed from the client to the server. A malicious client could claim services are connected when they aren't, manipulating which tools the AI has access to.

```typescript
const { messages, model, userId, projectId, connectedServices } = await req.json();
const connectedIds: string[] = Array.isArray(connectedServices) ? connectedServices : [];
const tools = getToolsForConnectors(connectedIds);
// Client controls which tools are available to the AI
```

### 21. PR #39 — Overly Permissive CSP connect-src

**Severity:** MEDIUM  
**File:** `next.config.ts`  
**Description:** The CSP `connect-src` directive now allows connections to many external domains, increasing the attack surface for data exfiltration via XSS.

```typescript
connect-src 'self' https://openrouter.ai https://js.stripe.com https://api.stripe.com
  https://*.supabase.co https://accounts.google.com https://oauth2.googleapis.com
  https://github.com https://api.github.com https://vercel.com https://api.vercel.com
  https://connect.stripe.com https://api.mercury.com https://api.ramp.com;
```

### 22. PR #35 — No Rate Limiting on Tool Execution

**Severity:** MEDIUM  
**File:** `src/app/api/chat/route.ts`  
**Description:** Tool execution (web search, save_decision, etc.) has no rate limiting. An attacker could abuse the web_search tool to make unlimited Brave Search API calls at the application's expense.

### 23. PR #13 — No Rate Limiting on Chat API

**Severity:** MEDIUM  
**File:** `src/app/api/chat/route.ts`  
**Description:** The chat endpoint has no rate limiting, allowing unlimited API calls to OpenRouter at the application's expense.

### 24. PR #38 — Financial Data Connector Definitions

**Severity:** MEDIUM  
**File:** `src/lib/connectors.ts`  
**Description:** Connector tool definitions for Stripe, Mercury, and Ramp suggest future access to highly sensitive financial data (payments, bank balances, transactions, spending). These tools are currently stubbed but the definitions are in place. When implemented, they will require robust authentication, authorization, and audit logging.

### 25. PR #39 — OAuth Token Encryption Key as Single Point of Failure

**Severity:** MEDIUM  
**File:** `src/lib/oauth.ts`  
**Description:** All OAuth tokens for all users are encrypted with a single `OAUTH_TOKEN_SECRET`. If this key is compromised, all stored OAuth tokens (access tokens and refresh tokens for Gmail, GitHub, Vercel, Stripe) can be decrypted.

---

## LOW Findings

### 26. PR #31 — Card Last 4 Digits in localStorage

**Severity:** LOW  
**File:** `src/lib/store.ts`  
**Description:** Card last 4 digits and card brand are stored in localStorage via Zustand persistence. While last-4 is not considered sensitive PII by most standards, it's unnecessary to persist this client-side.

```typescript
partialize: (s) => ({
  cardLast4: s.cardLast4,
  // persisted to localStorage
}),
```

### 27. PR #17 — Simulated Signatures Use Math.random()

**Severity:** LOW  
**File:** `src/lib/store.ts`  
**Description:** Receipt signatures and transaction hashes are generated using `Math.random()`, which is not cryptographically secure. While these are currently simulated/placeholder values, they could mislead users into thinking receipts are cryptographically verified.

```typescript
function shortHex() {
  return Math.random().toString(16).slice(2, 10);
}
// Used for: signature: `0x${shortHex()}${shortHex()}${shortHex()}`
```

### 28. PR #25 — Duplicate Stripe Env Vars in .env.example

**Severity:** LOW  
**File:** `.env.example`  
**Description:** `STRIPE_SECRET_KEY` and `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` appear twice in the `.env.example` file. While not a vulnerability, this could lead to configuration confusion.

### 29. PR #32 — Auth Challenge Expiry Without Cleanup

**Severity:** LOW  
**File:** `src/app/api/auth/register/route.ts`, `src/app/api/auth/login/route.ts`  
**Description:** WebAuthn auth challenges are created with a 5-minute expiry but there's no automated cleanup of expired challenges. Over time, the `auth_challenges` table will accumulate stale records.

### 30. PR #16 — No Cross-Project Authorization

**Severity:** LOW  
**File:** `src/lib/store.ts`  
**Description:** Project/workspace access is managed entirely client-side. While data is per-user in the client store, there's no server-side enforcement of project boundaries.

### 31. PR #35 — MAX_TOOL_ROUNDS Allows Recursive Tool Calls

**Severity:** LOW  
**File:** `src/app/api/chat/route.ts`  
**Description:** The tool execution loop allows up to 5 rounds (`MAX_TOOL_ROUNDS = 5`) of tool calls per request. While capped, each round could invoke multiple tools, potentially leading to resource exhaustion.

```typescript
const MAX_TOOL_ROUNDS = 5;
for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
  // Each round can have multiple tool calls
}
```

---

## PRs With No Security Findings

The following PRs contained only UI/styling changes, documentation updates, or dependency adjustments with no security implications:

- PR #14 (README update)
- PR #15 (useEffect dependency fix)
- PR #18 (Remove auto-settle, style cleanup)
- PR #19 (Meter pill, header dropdown)
- PR #20 (Meter pill tokens)
- PR #21 (Combined UI changes)
- PR #22 (Model picker refactor)
- PR #23 (Action cards, thinking indicator — UI only)
- PR #24 (Composer layout)
- PR #26 (Inspector/chat refactoring)
- PR #27 (Decisions panel simplification)
- PR #28 (Company switcher fix)
- PR #30 (Workspace persistence)
- PR #34 (WebAuthn transport defaults)
- PR #36 (WebAuthn credential ID fix)
- PR #40 (Connectors bar UI)

---

## Recommendations

1. **Implement server-side sessions immediately.** After WebAuthn authentication, issue a signed JWT or session cookie. Validate it on every API request. This is the single highest-impact fix.

2. **Add authentication middleware to all API routes.** Every endpoint that operates on user data must verify the caller's identity server-side.

3. **Remove `userId` from client-supplied request bodies.** Extract the user identity from the server-side session instead.

4. **Add rate limiting** to auth endpoints, chat API, and tool execution.

5. **Protect the `/api/setup-db` endpoint** with an admin secret or remove it entirely in production.

6. **Fix the user enumeration vulnerability** in `/api/auth/check` — return the same response regardless of whether the user exists.

7. **Tighten CSP** — remove `'unsafe-eval'` and `'unsafe-inline'` from `script-src` if possible, and narrow `connect-src` to only required domains.

8. **Add server-side authorization** for cross-account operations (sessions, OAuth, API keys).

9. **Implement audit logging** for sensitive operations (OAuth connections, API key management, financial data access).

10. **Add input validation** to all API endpoints using Zod or similar schema validation.
