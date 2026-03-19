/**
 * Server-side analytics for Meter API routes.
 *
 * Uses posthog-node to capture events from the server where the real
 * data lives: tokens consumed, actual costs, settlement amounts,
 * model routing decisions, and API v1 usage.
 */
import { PostHog } from "posthog-node";

const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY ?? "";
const POSTHOG_HOST =
  process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com";

let client: PostHog | null = null;

function getClient(): PostHog | null {
  if (!POSTHOG_KEY) return null;
  if (!client) {
    client = new PostHog(POSTHOG_KEY, {
      host: POSTHOG_HOST,
      flushAt: 20,
      flushInterval: 10000,
    });
  }
  return client;
}

function capture(
  userId: string,
  event: string,
  properties?: Record<string, unknown>,
) {
  const ph = getClient();
  if (!ph) return;
  ph.capture({ distinctId: userId, event, properties });
}

function identify(
  userId: string,
  properties?: Record<string, unknown>,
) {
  const ph = getClient();
  if (!ph) return;
  ph.identify({ distinctId: userId, properties });
}

// ─── Auth ───────────────────────────────────────────────────────────

export function serverTrackAccountCreated(
  userId: string,
  properties: { email: string },
) {
  capture(userId, "server_account_created", properties);
  identify(userId, { email: properties.email, created_at: new Date().toISOString() });
}

export function serverTrackUserLoggedIn(
  userId: string,
  properties: { email?: string; hasWorkspaces?: boolean; cardOnFile?: boolean },
) {
  capture(userId, "server_user_logged_in", properties);
  identify(userId, {
    email: properties.email,
    has_workspaces: properties.hasWorkspaces,
    card_on_file: properties.cardOnFile,
    last_login: new Date().toISOString(),
  });
}

export function serverTrackLoginFailed(properties: {
  email: string;
  reason: string;
}) {
  // Use email as distinct ID since we don't have a user ID
  capture(properties.email, "server_login_failed", properties);
}

export function serverTrackAccountDeleted(
  userId: string,
) {
  capture(userId, "server_account_deleted");
}

// ─── Chat / Tokens / Cost ───────────────────────────────────────────

export function serverTrackChatCompleted(
  userId: string,
  properties: {
    model: string;
    requestedModel: string;
    projectId?: string;
    tokensIn: number;
    tokensOut: number;
    cacheCreationTokens?: number;
    cacheReadTokens?: number;
    cacheReadRate?: number;
    toolRounds: number;
    toolsUsed: string[];
    isDebate: boolean;
    isSuperAdmin: boolean;
  },
) {
  capture(userId, "server_chat_completed", properties);
}

export function serverTrackChatFailed(
  userId: string,
  properties: {
    model: string;
    error: string;
    projectId?: string;
  },
) {
  capture(userId, "server_chat_failed", properties);
}

export function serverTrackModelRerouted(
  userId: string,
  properties: {
    requestedModel: string;
    actualModel: string;
    projectId?: string;
    reason?: string;
  },
) {
  capture(userId, "server_model_rerouted", properties);
}

export function serverTrackSpendLimitHit(
  userId: string,
  properties: {
    projectId: string;
    limitType: string;
    currentSpend: number;
    limit: number;
  },
) {
  capture(userId, "server_spend_limit_hit", properties);
}

export function serverTrackExposureCapHit(
  userId: string,
  properties: {
    projectId: string;
    outstanding: number;
    cap: number;
  },
) {
  capture(userId, "server_exposure_cap_hit", properties);
}

// ─── Settlement / Billing ───────────────────────────────────────────

export function serverTrackSettlementCompleted(
  userId: string,
  properties: {
    amount: number;
    workspaceId: string;
    messageCount: number;
    chargeCount: number;
    stripePaymentIntentId: string; // kept as analytics property name for backward compat
    cardLast4?: string;
    cardBrand?: string;
  },
) {
  capture(userId, "server_settlement_completed", properties);
  // Update person properties for revenue attribution
  identify(userId, { last_settlement_at: new Date().toISOString() });
}

export function serverTrackSettlementFailed(
  userId: string,
  properties: {
    amount: number;
    workspaceId: string;
    error: string;
  },
) {
  capture(userId, "server_settlement_failed", properties);
}

export function serverTrackSettlementWaived(
  userId: string,
  properties: {
    amount: number;
    workspaceId: string;
    messageCount: number;
  },
) {
  capture(userId, "server_settlement_waived", properties);
}

// ─── Sessions / Workspaces ──────────────────────────────────────────

export function serverTrackSessionCreated(
  userId: string,
  properties: { sessionId: string; projectName: string },
) {
  capture(userId, "server_session_created", properties);
}

export function serverTrackSessionDeleted(
  userId: string,
  properties: { sessionId: string },
) {
  capture(userId, "server_session_deleted", properties);
}

// ─── Decisions ──────────────────────────────────────────────────────

export function serverTrackDecisionSaved(
  userId: string,
  properties: {
    decisionId: string;
    title: string;
    status: string;
    projectId?: string;
  },
) {
  capture(userId, "server_decision_saved", properties);
}

// ─── Artifacts ──────────────────────────────────────────────────────

export function serverTrackArtifactsPushed(
  userId: string,
  properties: {
    repo: string;
    artifactCount: number;
    succeeded: number;
    failed: number;
    workspaceId?: string;
  },
) {
  capture(userId, "server_artifacts_pushed", properties);
}

// ─── API v1 (External) ─────────────────────────────────────────────

export function serverTrackApiV1Request(
  userId: string,
  properties: {
    apiKeyId: string;
    model: string;
    tokensIn: number;
    tokensOut: number;
  },
) {
  capture(userId, "server_api_v1_request", properties);
}

// ─── OAuth / Connectors ─────────────────────────────────────────────

export function serverTrackOAuthCompleted(
  userId: string,
  properties: {
    provider: string;
    workspaceId?: string;
  },
) {
  capture(userId, "server_oauth_completed", properties);
}

export function serverTrackOAuthDisconnected(
  userId: string,
  properties: {
    provider: string;
    workspaceId?: string;
  },
) {
  capture(userId, "server_oauth_disconnected", properties);
}
