# Security Review: PRs #41–#80

## Summary

This review covers PRs #41 through #80 for security vulnerabilities and data leaks. Multiple **CRITICAL** and **HIGH** severity findings were identified, primarily around missing authentication/authorization on sensitive API endpoints, insecure direct object references (IDOR), and blockchain private key handling.

**Total findings: 17** — 5 CRITICAL, 4 HIGH, 6 MEDIUM, 2 LOW

---

## Findings

---

### 1. CRITICAL — Missing Authentication on Billing Settlement Endpoint (IDOR)

**PR:** #59 (billing/settle/route.ts)

**Description:** The `/api/billing/settle` endpoint accepts `userId` and `stripeCustomerId` directly from the request body with **no authentication or authorization**. Any attacker who knows or guesses a `userId` can charge that user's credit card for arbitrary amounts. The server trusts the client-supplied `userId` to look up the Stripe customer and charge their default payment method.

**Relevant code:**
```typescript
export async function POST(req: NextRequest) {
  try {
    const { userId, stripeCustomerId, amount, messageIds, chargeIds } = await req.json();

    if (!userId || !amount || amount <= 0) {
      return NextResponse.json({ error: "userId and positive amount required" }, { status: 400 });
    }

    // ... proceeds to charge the user's card with NO auth check
    let customerId = stripeCustomerId;
    if (!customerId) {
      const { data: user } = await supabase
        .from("meter_users")
        .select("stripe_customer_id")
        .eq("id", userId)
        .single();
      customerId = user?.stripe_customer_id;
    }
```

**Impact:** An attacker can charge any user's card, mark their messages as settled, and trigger blockchain transactions on their behalf.

---

### 2. CRITICAL — Missing Authentication on Account Deletion Endpoint (IDOR)

**PR:** #62 (api/account/delete/route.ts)

**Description:** The `/api/account/delete` endpoint accepts `userId` from the request body with **no authentication**. An attacker can delete any user's account, including their Stripe customer, all chat data, sessions, decisions, workspaces, and credentials.

**Relevant code:**
```typescript
export async function POST(req: NextRequest) {
  try {
    const { userId } = await req.json();
    if (!userId) {
      return NextResponse.json({ error: "userId required" }, { status: 400 });
    }
    // ... proceeds to delete the entire account with no auth verification
    if (user.stripe_customer_id) {
      try {
        await stripe.customers.del(user.stripe_customer_id);
      } catch (e) { ... }
    }
```

**Impact:** Complete account takeover/destruction. Any attacker can delete any user's account and all associated data.

---

### 3. CRITICAL — Missing Authentication on Payment Card Management Endpoints (IDOR)

**PR:** #62 (api/billing/cards/*, api/billing/cards/add/route.ts, api/billing/cards/default/route.ts, api/billing/cards/[id]/route.ts)

**Description:** All card management endpoints accept `userId` from request body or query parameters with **no authentication**:
- `GET /api/billing/cards?userId=X` — lists all payment methods for any user
- `POST /api/billing/cards/add` — creates a Stripe SetupIntent for any user
- `POST /api/billing/cards/default` — sets any user's default payment method
- `DELETE /api/billing/cards/[id]?userId=X` — removes a card from any user's account

**Relevant code (GET cards):**
```typescript
export async function GET(req: NextRequest) {
  try {
    const userId = req.nextUrl.searchParams.get("userId");
    if (!userId) {
      return NextResponse.json({ error: "userId required" }, { status: 400 });
    }
    // No auth check — returns all cards for the given userId
```

**Impact:** An attacker can enumerate any user's payment methods (card brand, last4, expiry), add new cards, change the default card, or remove cards.

---

### 4. CRITICAL — Missing Authentication on Passkey Listing Endpoint

**PR:** #62 (api/auth/passkeys/route.ts)

**Description:** The `/api/auth/passkeys` endpoint returns passkey credential metadata for any user based on a `userId` query parameter with **no authentication**.

**Relevant code:**
```typescript
export async function GET(req: NextRequest) {
  try {
    const userId = req.nextUrl.searchParams.get("userId");
    if (!userId) {
      return NextResponse.json({ error: "userId required" }, { status: 400 });
    }
    // Returns passkey credentials for any userId with no auth
    const { data, error } = await supabase
      .from("passkey_credentials")
      .select("credential_id, device_type, backed_up, created_at")
      .eq("user_id", userId);
```

**Impact:** Leaks passkey credential IDs and metadata for any user. While this doesn't directly compromise the passkey, it reveals device information and credential identifiers.

---

### 5. CRITICAL — Missing Authentication on Billing History and Spend Limits

**PR:** #62 (api/billing/history/route.ts, api/billing/spend-limits/route.ts)

**Description:** The settlement history and spend limits endpoints accept `userId` from query parameters with **no authentication**:
- `GET /api/billing/history?userId=X` — returns all settlement history including Stripe PaymentIntent IDs and blockchain tx hashes
- `GET /api/billing/spend-limits?userId=X` — returns spending limit configuration
- `PUT /api/billing/spend-limits` — allows modifying any user's spend limits

**Relevant code (spend limits PUT):**
```typescript
export async function PUT(req: NextRequest) {
  try {
    const { userId, dailyLimit, monthlyLimit, perTxnLimit } = await req.json();
    if (!userId) {
      return NextResponse.json({ error: "userId required" }, { status: 400 });
    }
    // No auth check — modifies spend limits for any userId
    await supabase
      .from("meter_users")
      .update({ daily_limit: dailyLimit ?? null, ... })
      .eq("id", userId);
```

**Impact:** An attacker can view settlement history (including Stripe PaymentIntent IDs), modify spend limits to bypass restrictions, or set them to zero to disrupt service.

---

### 6. HIGH — Blockchain Settlement Private Key in Environment Variable

**PR:** #59 (lib/base.ts)

**Description:** The `METER_SETTLEMENT_PRIVATE_KEY` is loaded from an environment variable and used to sign Base blockchain transactions. While using env vars for secrets is standard, the code has no safeguards: the private key is loaded at module initialization time, and there's no key rotation mechanism or HSM integration. If this key leaks, the attacker gains full control of the settlement wallet.

**Relevant code:**
```typescript
const SETTLEMENT_PRIVATE_KEY = process.env.METER_SETTLEMENT_PRIVATE_KEY;

export async function batchSettle(...) {
  if (!SETTLEMENT_PRIVATE_KEY) {
    console.warn("METER_SETTLEMENT_PRIVATE_KEY not set, generating mock tx hash");
    const mockHash = `0x${Array.from({ length: 64 }, () => ...}`;
    return mockHash;
  }

  const account = privateKeyToAccount(SETTLEMENT_PRIVATE_KEY as `0x${string}`);
```

Additionally, the settlement payload includes the `userId` in plain text on-chain:
```typescript
const payload: SettlementPayload = {
  version: 1,
  timestamp: Date.now(),
  total,
  userId,  // PII stored on-chain permanently
  items,
};
const calldata = toHex(JSON.stringify(payload));
```

**Impact:** If the private key leaks, the attacker controls the settlement wallet. The userId is permanently recorded on the Base blockchain, constituting a data privacy concern.

---

### 7. HIGH — Missing Authentication on Chat API Enables Spend Limit Bypass

**PR:** #62 (api/chat/route.ts)

**Description:** The chat API endpoint accepts `userId` and `projectId` from the request body without authentication. The server-side spend limit check uses the client-supplied `userId` to look up limits. An attacker can:
1. Use any valid `userId` to send chat messages on their behalf (consuming their spend limits)
2. Pass a non-existent `userId` to bypass spend limits entirely
3. Use any `projectId` to bypass per-workspace limits (PR #70)

**Relevant code:**
```typescript
const { messages, model, userId, projectId, connectedServices } = await req.json();

if (userId) {
  const limitCheck = await checkSpendLimits(userId);
  if (limitCheck) {
    return new Response(JSON.stringify({ error: limitCheck }), { status: 429 });
  }
}
```

**Impact:** Spend limits can be trivially bypassed. API usage costs can be attributed to any user.

---

### 8. HIGH — Client-Supplied stripeCustomerId Trusted by Server

**PR:** #59 (lib/store.ts, billing/settle/route.ts)

**Description:** The settlement endpoint accepts `stripeCustomerId` from the client request body and uses it directly. While there's a fallback to look it up from the database, if the client supplies a `stripeCustomerId`, the server trusts it without verifying it belongs to the `userId`.

**Relevant code (client store):**
```typescript
body: JSON.stringify({
  userId: s.userId,
  stripeCustomerId: s.stripeCustomerId,  // Client-controlled value
  amount,
  messageIds: unsettledMsgs.map((m) => m.id),
  chargeIds: s.pendingCharges.filter((c) => !c.paidAt).map((c) => c.id),
}),
```

**Relevant code (server):**
```typescript
let customerId = stripeCustomerId;  // From client request
if (!customerId) {
  // Only falls back to DB lookup if client didn't supply one
}
```

**Impact:** An attacker could potentially charge a different Stripe customer by supplying a mismatched `stripeCustomerId`.

---

### 9. HIGH — Exposed Stripe PaymentIntent ID and Blockchain Tx Hash in API Responses

**PR:** #59 (billing/settle/route.ts)

**Description:** The settlement endpoint returns sensitive identifiers in its response, including the Stripe `paymentIntentId` and blockchain `txHash`. While the tx hash is public on-chain, the PaymentIntent ID can be used to look up payment details via the Stripe API if an attacker has API access.

**Relevant code:**
```typescript
return NextResponse.json({
  success: true,
  paymentIntentId: paymentIntent.id,
  txHash: txHash ?? null,
  amountCharged: amount,
});
```

**Impact:** Information disclosure of payment processing identifiers.

---

### 10. MEDIUM — API Key Placeholder Patterns Exposed in .env.example

**PR:** #58 (.env.example)

**Description:** The `.env.example` file was updated to include placeholder patterns for direct API keys from multiple providers, revealing the expected format of each key type.

**Relevant code:**
```
CLAUDE_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GEMINI_API_KEY=AI...
```

**Impact:** While these are placeholder patterns (not actual keys), they provide hints about key formats that could assist in validation of stolen credentials. The real risk is that developers may accidentally commit actual values.

---

### 11. MEDIUM — No Rate Limiting on Sensitive API Endpoints

**PR:** #59, #62 (multiple route files)

**Description:** None of the newly added API endpoints implement rate limiting:
- `/api/billing/settle` — allows unlimited settlement attempts
- `/api/account/delete` — allows unlimited account deletion attempts
- `/api/billing/cards/*` — allows unlimited card management operations
- `/api/auth/passkeys` — allows unlimited passkey enumeration

**Impact:** Enables brute-force attacks, credential enumeration, and denial of service against the billing system.

---

### 12. MEDIUM — Potential XSS via ReactMarkdown Rendering

**PR:** #46 (chat-view.tsx with react-markdown)

**Description:** PR #46 added `react-markdown` for rendering assistant messages. While `react-markdown` doesn't render raw HTML by default, the combination with `@tailwindcss/typography` and the prose classes could have rendering issues. Later PR #68 adds custom `mdComponents` which may introduce XSS vectors depending on their implementation.

**Relevant code:**
```tsx
<div className="prose prose-sm prose-invert max-w-none ...">
  <ReactMarkdown>{msg.content}</ReactMarkdown>
</div>
```

**Impact:** If the AI model output contains crafted markdown, it could potentially execute scripts or inject content, depending on the custom components.

---

### 13. MEDIUM — Session Deletion Endpoint Lacks Authentication

**PR:** #78 (api/sessions/route.ts)

**Description:** The new DELETE endpoint for sessions verifies session ownership by checking `userId` matches, but the `userId` itself comes from a query parameter with no actual authentication. An attacker who knows a user's ID can delete all their sessions.

**Relevant code:**
```typescript
export async function DELETE(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("sessionId");
  const userId = req.nextUrl.searchParams.get("userId");
  // Verifies ownership but userId comes from unauthenticated query param
  const { data: session } = await supabase
    .from("chat_sessions")
    .select("id")
    .eq("id", sessionId)
    .eq("user_id", userId)
    .single();
```

**Impact:** With knowledge of a userId, an attacker could delete all chat sessions.

---

### 14. MEDIUM — Auto-Settlement Triggers Without User Confirmation

**PR:** #59 (lib/store.ts)

**Description:** When the pending balance exceeds the `autoSettleThreshold` (default $10), the system automatically charges the user's card without explicit confirmation. This happens silently in `finalizeResponse()`.

**Relevant code:**
```typescript
finalizeResponse: (tokensIn, tokensOut, confidence) => {
  set((s) => { ... });
  const afterState = get();
  if (afterState.getPendingBalance() >= afterState.autoSettleThreshold) {
    afterState.settleAll();  // Automatically charges the card
  }
},
```

**Impact:** Users may be charged without explicit consent. Combined with the IDOR on the settle endpoint, this could be exploited to trigger charges on arbitrary users.

---

### 15. MEDIUM — PII (userId) Stored Permanently On-Chain

**PR:** #59 (lib/base.ts)

**Description:** The blockchain settlement function writes the `userId` and a full manifest of settlement items (IDs, amounts, types) to the Base blockchain as transaction calldata. This data is permanent and publicly visible.

**Relevant code:**
```typescript
const payload: SettlementPayload = {
  version: 1,
  timestamp: Date.now(),
  total,
  userId,       // User identifier permanently on-chain
  items,        // Individual charge IDs
};
const calldata = toHex(JSON.stringify(payload));
```

**Impact:** User identifiers and spending patterns are permanently recorded on a public blockchain, creating a GDPR/privacy compliance concern. Users cannot exercise their "right to be forgotten."

---

### 16. LOW — OAuth State Validation Has 10-Minute Window

**PR:** #77 (api/oauth/[provider]/authorize/route.ts)

**Description:** The OAuth state parameter has a 10-minute expiry window, which is reasonable but on the longer side. The implementation correctly validates state and cleans it up after use, which is good practice.

**Relevant code:**
```typescript
await supabase.from("oauth_state").insert({
  id: state,
  user_id: userId,
  provider: providerId,
  expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
});
```

**Impact:** Low. The 10-minute window slightly increases the attack surface for CSRF, but the state parameter provides adequate protection.

---

### 17. LOW — API Key Submission Includes Unsanitized Metadata Parameter

**PR:** #74 (api-key-dialog.tsx, api/oauth/api-key/route.ts)

**Description:** The API key submission flow was extended to include a `metadata` parameter (specifically for Supabase project URLs). This metadata is stored alongside the API key in the database without sanitization.

**Relevant code:**
```typescript
const { userId, provider, apiKey, metadata } = await req.json();
// ...
await storeApiKey(userId, provider, apiKey, metadata ?? null);
```

**Impact:** Low. The metadata parameter is validated only for presence (Supabase requires a project URL). No sanitization of the metadata content is performed, but it's stored as JSON in a controlled database context.

---

## PRs With No Security Issues Found

PRs #41, #42, #43, #44, #45, #48, #49, #50, #51, #52, #53, #54, #55, #56, #57, #60, #63, #64, #65, #66, #67, #69, #71, #72, #73, #75, #76, #79, #80 — These PRs contained UI changes, CSS updates, scroll behavior improvements, model picker changes, connector description updates, decision display improvements, and schema documentation. No security vulnerabilities were identified.

---

## Recommendations

1. **Implement server-side authentication on ALL API endpoints** — Use session tokens, JWTs, or server-side session validation. Never trust `userId` from the request body or query parameters.
2. **Remove `stripeCustomerId` from client-supplied request bodies** — Always look up the Stripe customer ID from the authenticated session on the server.
3. **Add rate limiting** to all sensitive endpoints (billing, account deletion, card management).
4. **Hash or anonymize `userId`** before writing to the blockchain to comply with privacy regulations.
5. **Use an HSM or KMS** for the settlement private key instead of a raw environment variable.
6. **Add CSRF protection** to all state-modifying API routes.
7. **Audit custom ReactMarkdown components** for XSS vectors.
8. **Add request signing or HMAC verification** for settlement-related API calls.
