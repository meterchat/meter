# Security Review: PRs #121 – #141

**Reviewer:** Automated Security Audit
**Date:** 2026-02-23
**Scope:** PR diffs #121 through #141

---

## Summary

| Severity | Count |
|----------|-------|
| CRITICAL | 0 |
| HIGH     | 1 |
| MEDIUM   | 2 |
| LOW      | 2 |

PRs with no security findings and therefore skipped: #121, #122, #124, #126, #127, #128, #131, #132, #133, #134, #135, #136, #137, #138, #139, #140, #141.

---

## Finding 1 — IDOR: Client-Supplied Message ID Used in Database Upsert

| Field | Value |
|-------|-------|
| **PR** | #123 |
| **Severity** | **HIGH** |
| **Category** | Insecure Direct Object Reference (IDOR) / Cross-Account Data Overwrite |
| **Status** | Reverted in PR #125 (no longer in codebase) |

### Description

PR #123 introduces a `assistantMessageId` parameter that is read directly from the client request body and used as the primary key in a Supabase `upsert` call with `onConflict: "id"`. Because the `id` value is entirely attacker-controlled, a malicious authenticated user can supply the message ID of *another* user's message. The upsert would then overwrite that row's `content`, `session_id`, `model`, token counts, and `receipt_status` with the attacker's data.

Although the `session_id` is constructed using the authenticated user's own `userId`, the upsert matches on the `id` column alone — meaning it will update any existing row regardless of its original owner.

### Attack Scenario

1. Attacker authenticates normally and starts a chat request.
2. Attacker sets `assistantMessageId` in the POST body to a known or guessed message ID belonging to another user.
3. Attacker disconnects mid-stream (triggering the background-save path).
4. The server overwrites the victim's message row with the attacker's AI-generated content and the attacker's session_id.

### Relevant Code

**`src/app/api/chat/route.ts`** (PR #123):
```typescript
const { messages, model, projectId, connectedServices, assistantMessageId } = await req.json();
```

Later, in the background-save block:
```typescript
await supabase.from("chat_messages").upsert({
  id: assistantMessageId,           // <-- attacker-controlled
  session_id: dbSessionId,
  role: "assistant",
  content: serverFullContent,
  model: activeModel,
  tokens_in: cumulativeTokensIn || null,
  tokens_out: cumulativeTokensOut || null,
  receipt_status: "server_completed",
  timestamp: Date.now(),
}, { onConflict: "id" });
```

### Recommendation

If this feature is reintroduced, the server should generate the message ID itself (never trust client-supplied IDs for database writes), or at minimum validate that the supplied ID does not already exist in the database belonging to a different user before performing the upsert.

---

## Finding 2 — WebAuthn User Verification Disabled

| Field | Value |
|-------|-------|
| **PR** | #125 |
| **Severity** | **MEDIUM** |
| **Category** | Authentication Weakening |
| **Status** | Active in codebase |

### Description

PR #125 adds `requireUserVerification: false` to both the **login** and **registration** WebAuthn verification calls. This disables the requirement for biometric confirmation (Face ID, Touch ID, Windows Hello) or a device PIN during passkey authentication.

With user verification disabled, passkey authentication proves only **possession** of the authenticator device, not that the legitimate owner is using it. For a financial product that handles billing, payments, and connected service credentials (OAuth tokens for Gmail, Stripe, GitHub, etc.), this materially reduces authentication strength.

### Relevant Code

**`src/app/api/auth/login/route.ts`** (PR #125):
```typescript
expectedChallenge: challengeRecord.challenge,
expectedOrigin: EXPECTED_ORIGINS,
expectedRPID: RP_ID,
requireUserVerification: false,   // <-- weakens auth
credential: {
  id: storedCred.credential_id,
  publicKey: Buffer.from(storedCred.public_key, "base64url"),
```

**`src/app/api/auth/register/route.ts`** (PR #125):
```typescript
expectedChallenge: challengeRecord.challenge,
expectedOrigin: EXPECTED_ORIGINS,
expectedRPID: RP_ID,
requireUserVerification: false,   // <-- weakens auth
```

### Recommendation

Re-enable `requireUserVerification: true` (or at least `"preferred"`) for a financial product. If certain authenticators don't support UV and users are being blocked, handle the error gracefully on the client and guide them to set up biometrics, rather than disabling the security check globally. The error message added in PR #125's `login-screen.tsx` suggests real users were hitting UV failures — the proper fix is better error UX, not disabling the check.

---

## Finding 3 — Fake Cryptographic Signatures Using Math.random()

| Field | Value |
|-------|-------|
| **PR** | #123 |
| **Severity** | **MEDIUM** |
| **Category** | Insecure Cryptographic Practice / Deceptive UI |
| **Status** | Reverted in PR #125 (no longer in codebase) |

### Description

The `recoverMessage` function in the Zustand store generates receipt "signatures" using `Math.random()`, producing strings that visually resemble cryptographic hex signatures but have no cryptographic validity or entropy guarantees. If users interpret these displayed signatures as proof of transaction integrity, they are being misled.

`Math.random()` is not a cryptographically secure random number generator — its output is predictable and should never be used in any context where signatures, tokens, or receipt identifiers are displayed to users as trustworthy.

### Relevant Code

**`src/lib/store.ts`** (PR #123):
```typescript
recoverMessage: (messageId, content, meta) =>
  set((s) => {
    // ...
    return {
      ...m,
      content,
      receiptStatus: "signed" as const,
      signature: `0x${Math.random().toString(16).slice(2, 10)}…`,  // <-- fake sig
    };
  }),
```

### Recommendation

If receipt signatures are intended to convey authenticity, use `crypto.getRandomValues()` (Web Crypto API) at minimum for generating identifiers, or implement real cryptographic signing (ECDSA/EdDSA) as noted in the project's own DESIGN.md. If signatures are purely cosmetic, clearly label them as such in the UI to avoid misleading users.

---

## Finding 4 — Recovery Endpoint Missing Message ID Format Validation

| Field | Value |
|-------|-------|
| **PR** | #123 |
| **Severity** | **LOW** |
| **Category** | Missing Input Validation |
| **Status** | Reverted in PR #125 (no longer in codebase) |

### Description

The `/api/chat/recover` GET endpoint accepts a `messageId` query parameter and passes it directly to a Supabase query without validating its format, length, or character set. While Supabase uses parameterized queries (preventing SQL injection), the lack of validation means:

- Arbitrarily long strings can be sent, potentially causing performance issues.
- The endpoint can be probed to enumerate message IDs (the response distinguishes between "not found" and "found but not yours" only via the session_id prefix check, but both return `{ message: null }`, which is good).

### Relevant Code

**`src/app/api/chat/recover/route.ts`** (PR #123):
```typescript
const messageId = req.nextUrl.searchParams.get("messageId");
if (!messageId) {
  return NextResponse.json({ error: "Missing messageId" }, { status: 400 });
}

// No format/length validation before DB query
const { data: message, error } = await supabase
  .from("chat_messages")
  .select("id, session_id, content, model, tokens_in, tokens_out, receipt_status, timestamp")
  .eq("id", messageId)
  .single();
```

### Recommendation

Validate the `messageId` format (e.g., UUID pattern, maximum length) before issuing the database query.

---

## Finding 5 — No Rate Limiting on API Endpoints (By Design)

| Field | Value |
|-------|-------|
| **PR** | #129 |
| **Severity** | **LOW** |
| **Category** | Missing Rate Limiting |
| **Status** | Active (documented design decision) |

### Description

PR #129 introduces `DESIGN.md` which explicitly documents that Meter imposes **no request-per-minute or messages-per-hour rate limits** on any endpoint. The rationale is that per-token billing makes abuse "self-limiting." However, this leaves all API endpoints (including `/api/chat`, `/api/auth/login`, `/api/sessions`, `/api/billing/*`, `/api/chat/recover`) vulnerable to:

- **Brute-force attacks** on the authentication flow (passkey challenge enumeration).
- **Denial-of-wallet attacks** where a compromised session racks up charges before the exposure cap kicks in.
- **Resource exhaustion** against AI provider backends via rapid request flooding.

### Relevant Code

**`DESIGN.md`** (PR #129):
```markdown
## 14. No Rate Limits

Meter imposes no request-per-minute or messages-per-hour rate limits.
The only limits are cost-based: user-configured spend caps (daily/monthly
per workspace) and the trust-tiered exposure cap after failed settlement.
If you can pay for it, you can use it.
```

### Recommendation

Even in a pay-per-use model, rate limiting is essential for:
- Authentication endpoints (prevent credential stuffing / challenge enumeration).
- Billing endpoints (prevent settlement flooding).
- The chat endpoint (prevent runaway cost accumulation faster than the exposure cap can react).

Implement at minimum a per-IP and per-user rate limit on `/api/auth/*` endpoints.

---

## PRs With No Security Findings

| PR | Summary | Notes |
|----|---------|-------|
| #121 | Fallback error reason accumulation | Code quality improvement, no security impact |
| #122 | Conditional tools array in API calls | Minor API fix, no security impact |
| #124 | Producer-consumer stream refactor | Architecture change only (same security profile as #123) |
| #126 | Stop button color change | Purely cosmetic |
| #127 | Rename "Meter 1.0" → "Parameter 1.0" | Brand rename only |
| #128 | Rename "Parameter 1.0" → "Meter 1.0" | Brand rename revert |
| #131 | Soft-delete, light mode, workspace rename | Soft-delete improves data safety; rename is client-side |
| #132 | Onboarding flow + DESIGN.md (variant) | Same as #129 on different base; no new issues |
| #133 | Decision ID dedup + tool return format | Improves data consistency |
| #134 | Soft-delete, light mode, theme (variant) | Same as #131 on different base; no new issues |
| #135 | Light mode CSS prose fixes | Purely cosmetic |
| #136 | Server-side workspace detection for login | Fixes race condition; properly auth-gated |
| #137 | UI tweaks (icon sizes, tagline) | Purely cosmetic |
| #138 | Message pinning feature | Client-side state only, no server interaction |
| #139 | Pin click-to-scroll + time formatting | Client-side UI only |
| #140 | Pin/copy buttons for user messages | Client-side UI only |
| #141 | Title change, chevron size | Purely cosmetic |
