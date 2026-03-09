#!/usr/bin/env bash
# migrate-env.sh — Pull env vars from Vercel, push to Cloudflare Pages
set -euo pipefail

# --- Config (set these or export before running) ---
VERCEL_TOKEN="${VERCEL_TOKEN:?Set VERCEL_TOKEN (vercel.com/account/tokens)}"
VERCEL_PROJECT="${VERCEL_PROJECT:-meter}"
CF_ACCOUNT_ID="${CF_ACCOUNT_ID:?Set CF_ACCOUNT_ID (dashboard URL)}"
CF_API_TOKEN="${CF_API_TOKEN:?Set CF_API_TOKEN (dash.cloudflare.com/profile/api-tokens)}"
CF_PROJECT="${CF_PROJECT:-meter}"
ENV="${1:-production}"

echo "==> Pulling env vars from Vercel ($VERCEL_PROJECT, $ENV)..."

# Fetch Vercel env vars as JSON
VERCEL_VARS=$(curl -sf "https://api.vercel.com/v9/projects/$VERCEL_PROJECT/env" \
  -H "Authorization: Bearer $VERCEL_TOKEN" | \
  jq -r --arg env "$ENV" '
    [.envs[] | select(.target[] == $env and .type != "system")]
  ')

COUNT=$(echo "$VERCEL_VARS" | jq length)
echo "    Found $COUNT env vars"

if [ "$COUNT" -eq 0 ]; then
  echo "No env vars found. Check your VERCEL_TOKEN and VERCEL_PROJECT."
  exit 1
fi

# Build Cloudflare env_vars object: { "KEY": { "type": "secret_text", "value": "..." } }
CF_ENV_VARS=$(echo "$VERCEL_VARS" | jq '
  reduce .[] as $v ({}; . + {
    ($v.key): { type: "secret_text", value: $v.value }
  })
')

echo "==> Pushing $COUNT env vars to Cloudflare Pages ($CF_PROJECT, $ENV)..."

CF_CONFIG_KEY=$([ "$ENV" = "production" ] && echo "production" || echo "preview")

RESULT=$(curl -sf -X PATCH \
  "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/pages/projects/$CF_PROJECT" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$(jq -n --argjson vars "$CF_ENV_VARS" --arg key "$CF_CONFIG_KEY" \
    '{deployment_configs: {($key): {env_vars: $vars}}}')")

SUCCESS=$(echo "$RESULT" | jq -r '.success')
if [ "$SUCCESS" = "true" ]; then
  echo "==> Done! $COUNT env vars migrated to Cloudflare Pages ($ENV)."
else
  echo "==> Failed:"
  echo "$RESULT" | jq .
  exit 1
fi
