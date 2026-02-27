import crypto from "crypto";
import { getSupabaseServer } from "@/lib/supabase";

/* ─── Provider configuration ──────────────────────────────────── */

export interface OAuthProviderConfig {
  id: string;
  name: string;
  type: "oauth" | "api_key";
  authorizeUrl?: string;
  tokenUrl?: string;
  scopes?: string[];
  clientIdEnv: string;
  clientSecretEnv: string;
}

export const OAUTH_PROVIDERS: Record<string, OAuthProviderConfig> = {
  github: {
    id: "github",
    name: "GitHub",
    type: "oauth",
    authorizeUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    scopes: ["repo", "read:user"],
    clientIdEnv: "GITHUB_CLIENT_ID",
    clientSecretEnv: "GITHUB_CLIENT_SECRET",
  },
  stripe: {
    id: "stripe",
    name: "Stripe",
    type: "oauth",
    authorizeUrl: "https://connect.stripe.com/oauth/authorize",
    tokenUrl: "https://connect.stripe.com/oauth/token",
    scopes: ["read_write"],
    clientIdEnv: "STRIPE_CONNECT_CLIENT_ID",
    clientSecretEnv: "STRIPE_SECRET_KEY",
  },
  mercury: { id: "mercury", name: "Mercury", type: "api_key", clientIdEnv: "", clientSecretEnv: "" },
  posthog: { id: "posthog", name: "PostHog", type: "api_key", clientIdEnv: "", clientSecretEnv: "" },
  agentcard: { id: "agentcard", name: "AgentCard", type: "api_key", clientIdEnv: "", clientSecretEnv: "" },
};

/* ─── Token encryption ────────────────────────────────────────── */

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function getEncryptionKey(): Buffer {
  const secret = process.env.OAUTH_TOKEN_SECRET;
  if (!secret) throw new Error("Missing OAUTH_TOKEN_SECRET env var");
  return Buffer.from(secret, "hex");
}

export function encryptToken(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Format: iv:tag:ciphertext (all base64)
  return `${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

export function decryptToken(ciphertext: string): string {
  const key = getEncryptionKey();
  const [ivB64, tagB64, encB64] = ciphertext.split(":");
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const encrypted = Buffer.from(encB64, "base64");
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(encrypted) + decipher.final("utf8");
}

/* ─── OAuth state management ──────────────────────────────────── */

export function generateState(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function buildAuthorizeUrl(
  provider: OAuthProviderConfig,
  state: string,
  redirectUri: string
): string {
  const clientId = process.env[provider.clientIdEnv];
  if (!clientId) throw new Error(`Missing ${provider.clientIdEnv} env var`);

  const params = new URLSearchParams();

  if (provider.id === "stripe") {
    // Stripe Connect uses different param names
    params.set("response_type", "code");
    params.set("client_id", clientId);
    params.set("scope", provider.scopes?.join(" ") ?? "");
    params.set("redirect_uri", redirectUri);
    params.set("state", state);
  } else if (provider.id === "github") {
    params.set("client_id", clientId);
    params.set("redirect_uri", redirectUri);
    params.set("scope", provider.scopes?.join(" ") ?? "");
    params.set("state", state);
  } else {
    // Standard OAuth2 (Google, Vercel)
    params.set("response_type", "code");
    params.set("client_id", clientId);
    params.set("redirect_uri", redirectUri);
    params.set("scope", provider.scopes?.join(" ") ?? "");
    params.set("state", state);
    params.set("access_type", "offline");
    params.set("prompt", "consent");
  }

  return `${provider.authorizeUrl}?${params.toString()}`;
}

/* ─── Token exchange ──────────────────────────────────────────── */

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
}

export async function exchangeCodeForToken(
  provider: OAuthProviderConfig,
  code: string,
  redirectUri: string
): Promise<TokenResponse> {
  const clientId = process.env[provider.clientIdEnv];
  const clientSecret = process.env[provider.clientSecretEnv];
  if (!clientId || !clientSecret) {
    throw new Error(`Missing OAuth credentials for ${provider.name}`);
  }

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    client_secret: clientSecret,
  });

  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
  };

  // GitHub requires Accept: application/json
  if (provider.id === "github") {
    headers.Accept = "application/json";
  }

  const res = await fetch(provider.tokenUrl!, {
    method: "POST",
    headers,
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "unknown error");
    throw new Error(`Token exchange failed for ${provider.name}: ${res.status} ${text}`);
  }

  const json = await res.json();

  // GitHub returns HTTP 200 with {"error": "...", "error_description": "..."} on failure
  if (json.error) {
    throw new Error(
      `Token exchange failed for ${provider.name}: ${json.error} – ${json.error_description ?? ""}`
    );
  }

  if (!json.access_token) {
    throw new Error(`Token exchange for ${provider.name} returned no access_token`);
  }

  return json;
}

/* ─── Token storage ───────────────────────────────────────────── */

export async function storeToken(
  userId: string,
  provider: string,
  workspaceId: string,
  tokenData: TokenResponse,
  metadata?: Record<string, unknown> | null
): Promise<void> {
  const supabase = getSupabaseServer();

  // Delete-then-insert to avoid relying on unique constraint
  await supabase
    .from("oauth_tokens")
    .delete()
    .eq("user_id", userId)
    .eq("provider", provider)
    .eq("workspace_id", workspaceId);

  const id = `tok_${crypto.randomBytes(8).toString("hex")}`;
  const expiresAt = tokenData.expires_in
    ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
    : null;

  const { error } = await supabase.from("oauth_tokens").insert({
    id,
    user_id: userId,
    provider,
    workspace_id: workspaceId,
    access_token: encryptToken(tokenData.access_token),
    refresh_token: tokenData.refresh_token ? encryptToken(tokenData.refresh_token) : null,
    expires_at: expiresAt,
    scopes: tokenData.scope ?? null,
    metadata: metadata ?? null,
    updated_at: new Date().toISOString(),
  });
  if (error) {
    throw new Error(`Failed to store token for ${provider}: ${error.message}`);
  }
}

export async function storeApiKey(
  userId: string,
  provider: string,
  workspaceId: string,
  apiKey: string,
  metadata?: Record<string, unknown> | null
): Promise<void> {
  const supabase = getSupabaseServer();

  // Delete any existing token for this user/provider first (regardless of
  // workspace_id), then insert. This handles rows created with the old
  // unique(user_id, provider) constraint that have workspace_id = ''.
  await supabase
    .from("oauth_tokens")
    .delete()
    .eq("user_id", userId)
    .eq("provider", provider);

  const id = `tok_${crypto.randomBytes(8).toString("hex")}`;
  const { error } = await supabase.from("oauth_tokens").insert({
    id,
    user_id: userId,
    provider,
    workspace_id: workspaceId,
    access_token: encryptToken(apiKey),
    refresh_token: null,
    expires_at: null,
    scopes: null,
    metadata: metadata ?? null,
    updated_at: new Date().toISOString(),
  });
  if (error) {
    throw new Error(`Failed to store API key for ${provider}: ${error.message}`);
  }
}

export async function getTokenRecord(
  userId: string,
  provider: string,
  workspaceId: string
): Promise<{ accessToken: string; refreshToken?: string; expiresAt?: string | null; metadata?: Record<string, unknown> | null } | null> {
  const supabase = getSupabaseServer();
  const { data } = await supabase
    .from("oauth_tokens")
    .select("access_token, refresh_token, expires_at, metadata")
    .eq("user_id", userId)
    .eq("provider", provider)
    .eq("workspace_id", workspaceId)
    .single();

  if (!data) return null;

  return {
    accessToken: decryptToken(data.access_token),
    refreshToken: data.refresh_token ? decryptToken(data.refresh_token) : undefined,
    expiresAt: data.expires_at ?? null,
    metadata: (data.metadata as Record<string, unknown> | null) ?? null,
  };
}

export async function getToken(
  userId: string,
  provider: string,
  workspaceId: string
): Promise<{ accessToken: string; refreshToken?: string } | null> {
  const record = await getTokenRecord(userId, provider, workspaceId);
  if (!record) return null;
  return {
    accessToken: record.accessToken,
    refreshToken: record.refreshToken,
  };
}

async function refreshAccessToken(
  provider: OAuthProviderConfig,
  refreshToken: string
): Promise<TokenResponse> {
  const clientId = process.env[provider.clientIdEnv];
  const clientSecret = process.env[provider.clientSecretEnv];
  if (!clientId || !clientSecret) {
    throw new Error(`Missing OAuth credentials for ${provider.name}`);
  }

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });

  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
  };

  if (provider.id === "github") {
    headers.Accept = "application/json";
  }

  const res = await fetch(provider.tokenUrl!, {
    method: "POST",
    headers,
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "unknown error");
    throw new Error(`Refresh failed for ${provider.name}: ${res.status} ${text}`);
  }

  return res.json();
}

export async function getValidAccessToken(
  userId: string,
  providerId: string,
  workspaceId: string
): Promise<{ accessToken: string; metadata?: Record<string, unknown> | null } | null> {
  const provider = OAUTH_PROVIDERS[providerId];
  if (!provider) return null;

  const record = await getTokenRecord(userId, providerId, workspaceId);
  if (!record) return null;

  if (!record.expiresAt) {
    return { accessToken: record.accessToken, metadata: record.metadata ?? null };
  }

  const expiresAtMs = new Date(record.expiresAt).getTime();
  if (Number.isNaN(expiresAtMs)) {
    return { accessToken: record.accessToken, metadata: record.metadata ?? null };
  }

  const needsRefresh = expiresAtMs - Date.now() < 60_000;
  if (!needsRefresh) {
    return { accessToken: record.accessToken, metadata: record.metadata ?? null };
  }

  if (!record.refreshToken) {
    throw new Error(`Token expired for ${provider.name}. Please reconnect.`);
  }

  const refreshed = await refreshAccessToken(provider, record.refreshToken);
  const tokenData: TokenResponse = {
    ...refreshed,
    refresh_token: refreshed.refresh_token ?? record.refreshToken,
  };
  await storeToken(userId, providerId, workspaceId, tokenData, record.metadata ?? null);

  return { accessToken: tokenData.access_token, metadata: record.metadata ?? null };
}

export async function deleteToken(userId: string, provider: string, workspaceId: string): Promise<void> {
  const supabase = getSupabaseServer();
  await supabase
    .from("oauth_tokens")
    .delete()
    .eq("user_id", userId)
    .eq("provider", provider)
    .eq("workspace_id", workspaceId);
}

export async function getConnectionStatus(
  userId: string,
  workspaceId: string
): Promise<Record<string, boolean>> {
  const supabase = getSupabaseServer();
  const { data, error } = await supabase
    .from("oauth_tokens")
    .select("provider")
    .eq("user_id", userId)
    .eq("workspace_id", workspaceId);

  if (error) {
    console.error("getConnectionStatus error:", error.message);
  }
  const status: Record<string, boolean> = {};
  for (const row of data ?? []) {
    status[row.provider] = true;
  }
  return status;
}
