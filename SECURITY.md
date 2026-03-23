# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Meter, please report it responsibly.

**Do NOT open a public GitHub issue for security vulnerabilities.**

Instead, email **security@getmeter.dev** with:

- A description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

We will acknowledge receipt within 48 hours and provide a detailed response within 7 days.

## Scope

The following are in scope:

- API authentication (API key validation, rate limiting)
- WebAuthn authentication flow
- Server-side API routes (`/api/chat`, `/api/v1/*`)
- Stripe billing integration
- OAuth token handling (GitHub, Google, Vercel, Stripe)
- API key connectors (Mercury, PostHog, Ramp, Porkbun, Supabase)
- Settlement and payment processing

## Architecture Security Notes

- **No PII** — No personal data collected beyond what's needed for authentication
- **Server-side secrets** — API keys and service role keys are never exposed to the client
- **WebAuthn** — Passkey-based authentication, no passwords stored
- **OAuth tokens** — Encrypted at rest with AES-256-GCM (12-byte IV, 16-byte auth tag) using `OAUTH_TOKEN_SECRET`
- **Row-Level Security** — Supabase RLS enabled on all user data tables, enforcing user_id ownership
- **API keys** — Stored as SHA-256 hashes with visible prefix for identification; raw keys shown only at creation

## Supported Versions

| Version | Supported |
|---------|-----------|
| Latest `main` | Yes |
| Older commits | No |

## Disclosure Policy

- We follow coordinated disclosure
- We will credit reporters in the changelog (unless anonymity is requested)
- We aim to patch critical vulnerabilities within 72 hours of confirmation
