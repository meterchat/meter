# Security Review: Leaked Secrets in Git History

## Executive Summary

A comprehensive scan of the **entire git history** of this repository revealed **6 distinct secrets/credentials** that were committed to the repository across **3 commits**. While the `.env.local` file was later removed (commit `744ba6f`), **the secrets remain permanently accessible in the git history** and must be considered compromised.

**Current state:** The `.env.local` file has been deleted from the working tree and added to `.gitignore`. However, the secrets are still retrievable via `git log` / `git show` on any clone of this repo.

---

## Leaked Secrets

### 1. CRITICAL — OpenAI API Key (sk-proj-...)

| Field | Value |
|---|---|
| **Secret** | `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` |
| **Variable** | `OPENAI_API_KEY` |
| **File** | `.env.local` |
| **First committed** | `703d792b` — "Initial commit from Orchids" (Feb 14, 2026 01:19 UTC) by syedOS |
| **Also in** | `08412f72` — "feat: add API keys management..." (Feb 14, 2026 16:13 UTC) by syedOS |
| **Removed in** | `744ba6f0` — "Remove leaked secrets from repo" (Feb 14, 2026 22:16 UTC) by Claude |
| **Risk** | Anyone with this key can make API calls to OpenAI, incurring charges on the key owner's account. |
| **Action required** | **ROTATE IMMEDIATELY** at https://platform.openai.com/api-keys |

---

### 2. CRITICAL — Supabase Service Role Key (full admin access)

| Field | Value |
|---|---|
| **Secret** | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl6amV2aHNhY3ZxYmN5Z2JtZXdrIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTAzMDQwNCwiZXhwIjoyMDg2NjA2NDA0fQ.KopuOrCaU1H28ujm3kExSSp8FVcGIc8dP8FdU7rBQZE` |
| **Variable** | `SUPABASE_SERVICE_ROLE_KEY` |
| **File** | `.env.local` |
| **First committed** | `08412f72` — "feat: add API keys management..." (Feb 14, 2026 16:13 UTC) by syedOS |
| **Removed in** | `744ba6f0` — "Remove leaked secrets from repo" (Feb 14, 2026 22:16 UTC) by Claude |
| **Decoded JWT payload** | `{"iss":"supabase","ref":"yzjevhsacvqbcygbmewk","role":"service_role","iat":1771030404,"exp":2086606404}` |
| **Risk** | **This is the most dangerous leak.** The service role key bypasses all Row Level Security (RLS) policies and grants full read/write/delete access to every table in the Supabase project `yzjevhsacvqbcygbmewk`. An attacker can read all user data, modify records, and delete tables. |
| **Action required** | **ROTATE IMMEDIATELY** at Supabase Dashboard → Settings → API → Regenerate service_role key |

---

### 3. HIGH — Supabase Anon Key

| Field | Value |
|---|---|
| **Secret** | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl6amV2aHNhY3ZxYmN5Z2JtZXdrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEwMzA0MDQsImV4cCI6MjA4NjYwNjQwNH0.YE-PwLoqGDXBA-77Cmn0a2qzamkwI21F6B3GwtyO_tg` |
| **Variable** | `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| **File** | `.env.local` |
| **First committed** | `08412f72` — "feat: add API keys management..." (Feb 14, 2026 16:13 UTC) by syedOS |
| **Removed in** | `744ba6f0` — "Remove leaked secrets from repo" (Feb 14, 2026 22:16 UTC) by Claude |
| **Decoded JWT payload** | `{"iss":"supabase","ref":"yzjevhsacvqbcygbmewk","role":"anon","iat":1771030404,"exp":2086606404}` |
| **Risk** | The anon key is designed to be public-facing (used in browsers), but combined with the leaked project URL, it allows anyone to query the Supabase API. If RLS is not properly configured on all tables, data may be exposed. Should be rotated together with the service role key. |
| **Action required** | **ROTATE** at Supabase Dashboard → Settings → API → Regenerate anon key |

---

### 4. HIGH — Supabase Project URL

| Field | Value |
|---|---|
| **Secret** | `https://yzjevhsacvqbcygbmewk.supabase.co` |
| **Variable** | `NEXT_PUBLIC_SUPABASE_URL` |
| **File** | `.env.local` |
| **First committed** | `08412f72` — "feat: add API keys management..." (Feb 14, 2026 16:13 UTC) by syedOS |
| **Removed in** | `744ba6f0` — "Remove leaked secrets from repo" (Feb 14, 2026 22:16 UTC) by Claude |
| **Risk** | Reveals the exact Supabase project identifier (`yzjevhsacvqbcygbmewk`). Combined with the leaked keys above, provides full access to the database. |

---

### 5. MEDIUM — Privy App ID (Chat)

| Field | Value |
|---|---|
| **Secret** | `cmlli69in000i0dlaof7up8r9` |
| **Variable** | `NEXT_PUBLIC_PRIVY_APP_ID` |
| **File** | `.env.local` |
| **First committed** | `703d792b` — "Initial commit from Orchids" (Feb 14, 2026 01:19 UTC) by syedOS |
| **Removed in** | `744ba6f0` — "Remove leaked secrets from repo" (Feb 14, 2026 22:16 UTC) by Claude |
| **Risk** | Privy app IDs are somewhat public (used in client-side code), but leaking them allows impersonation of the app's authentication flow. |

---

### 6. MEDIUM — Privy Console App ID

| Field | Value |
|---|---|
| **Secret** | `cmlmae8ch013f0cl8aq4no5po` |
| **Variable** | `NEXT_PUBLIC_PRIVY_CONSOLE_APP_ID` |
| **File** | `.env.local` |
| **First committed** | `08412f72` — "feat: add API keys management..." (Feb 14, 2026 16:13 UTC) by syedOS |
| **Removed in** | `744ba6f0` — "Remove leaked secrets from repo" (Feb 14, 2026 22:16 UTC) by Claude |
| **Risk** | Same as above — allows impersonation of the console app's auth flow. |

---

## Negative Results (No Secrets Found)

The following searches returned **no results**, meaning these types of secrets were never committed:

| Pattern | Description | Result |
|---|---|---|
| `sk-or-` in code files | OpenRouter API keys | **Not found** (only placeholders in `.env.example`) |
| `sk_live_` | Stripe live secret keys | **Not found** |
| `sk_test_` | Stripe test secret keys | **Not found** (only placeholders in `.env.example`) |
| `BEGIN RSA` | RSA private keys | **Not found** |
| `BEGIN PRIVATE` | Generic private keys | **Not found** |
| `*.key`, `*.pem`, `*.p12`, `*.pfx` files | Private key files | **Not found** |
| `.env.production` | Production env file | **Not found** |
| `METER_SETTLEMENT_PRIVATE_KEY` actual value | Blockchain settlement key | **Not found** (only `process.env` references) |
| `STRIPE_SECRET_KEY` actual value | Stripe secret key | **Not found** (only `process.env` references and placeholders) |
| `OAUTH_TOKEN_SECRET` actual value | OAuth encryption key | **Not found** (only `process.env` references) |

---

## Timeline of Exposure

| Date | Commit | Event |
|---|---|---|
| Feb 14 01:19 UTC | `703d792b` | **Initial commit** — `.env.local` committed with OpenAI key + Privy app ID |
| Feb 14 16:13 UTC | `08412f72` | **More secrets added** — Supabase URL, anon key, service role key, second Privy ID added to `.env.local` |
| Feb 14 22:16 UTC | `744ba6f0` | **Cleanup attempt** — `.env.local` deleted, `.gitignore` restored. Secrets remain in git history |

---

## Commits Containing Secrets

### Commit `703d792b` — Initial commit from Orchids
- **Author:** syedOS
- **Date:** Feb 14, 2026 01:19 UTC
- **Secrets:** `OPENAI_API_KEY`, `NEXT_PUBLIC_PRIVY_APP_ID`

### Commit `08412f72` — feat: add API keys management, console dashboard, and auth middleware
- **Author:** syedOS
- **Date:** Feb 14, 2026 16:13 UTC
- **Secrets:** All 6 secrets (added Supabase keys + console Privy ID)

### Commit `744ba6f0` — Remove leaked secrets from repo and restore .gitignore
- **Author:** Claude
- **Date:** Feb 14, 2026 22:16 UTC
- **Note:** This commit _deleted_ `.env.local` but the secrets are still visible in this commit's diff (showing the deletion)

---

## Required Remediation

### Immediate Actions (must do NOW)

1. **Rotate the OpenAI API key** — Go to https://platform.openai.com/api-keys, revoke the old key, generate a new one
2. **Rotate both Supabase keys** — Go to Supabase Dashboard → Settings → API, regenerate both the `anon` and `service_role` keys
3. **Audit Supabase access logs** — Check for unauthorized queries using the leaked service role key
4. **Audit OpenAI usage** — Check for unauthorized API calls on the compromised key

### Recommended Actions

5. **Scrub git history** — Use `git filter-repo` or BFG Repo-Cleaner to permanently remove `.env.local` from all commits, then force-push. All collaborators must re-clone.
6. **Enable GitHub secret scanning** — If not already enabled, activate GitHub's secret scanning and push protection
7. **Rotate Privy app IDs** — Create new Privy apps if concerned about impersonation
8. **Add pre-commit hooks** — Use tools like `detect-secrets` or `gitleaks` to prevent future secret commits
9. **Review Supabase RLS policies** — Ensure all tables have proper Row Level Security since the anon key was exposed
