/**
 * Comprehensive analytics event catalog for Meter.
 *
 * Every user action, system event, and product metric flows through here.
 * Uses PostHog for event capture and user identification.
 */
import { posthog } from "@/lib/posthog";

// ─── Helpers ────────────────────────────────────────────────────────────

function capture(event: string, properties?: Record<string, unknown>) {
  posthog.capture(event, properties);
}

// ─── User Identification ────────────────────────────────────────────────

export function identifyUser(
  userId: string,
  properties?: {
    email?: string | null;
    accountType?: string;
    cardOnFile?: boolean;
    workspaceCount?: number;
    passkeyCount?: number;
  },
) {
  posthog.identify(userId, properties);
}

export function resetUser() {
  posthog.reset();
}

// ─── Auth & Account ─────────────────────────────────────────────────────

export function trackAccountCreated(properties?: { method?: string }) {
  capture("account_created", properties);
}

export function trackUserLoggedIn(properties?: { method?: string }) {
  capture("user_logged_in", properties);
}

export function trackUserLoggedOut() {
  capture("user_logged_out");
}

export function trackLoginFailed(properties: { method: string; error: string }) {
  capture("login_failed", properties);
}

export function trackCrossDeviceAuthStarted() {
  capture("cross_device_auth_started");
}

export function trackAccountDeleted() {
  capture("account_deleted");
}

export function trackProfileOpened() {
  capture("profile_opened");
}

// ─── Workspace ──────────────────────────────────────────────────────────

export function trackWorkspaceCreated(properties: { name: string; source?: string }) {
  capture("workspace_created", properties);
}

export function trackWorkspaceSwitched(properties: { workspaceId: string; workspaceName: string }) {
  capture("workspace_switched", properties);
}

export function trackWorkspaceRenamed(properties: { workspaceId: string; oldName: string; newName: string }) {
  capture("workspace_renamed", properties);
}

export function trackWorkspaceDeleted(properties: { workspaceId: string; workspaceName: string }) {
  capture("workspace_deleted", properties);
}

// ─── Chat & Messages ────────────────────────────────────────────────────

export function trackMessageSent(properties: {
  model: string;
  projectId: string;
  hasAttachments?: boolean;
  attachmentCount?: number;
  messageLength?: number;
}) {
  capture("message_sent", properties);
}

export function trackMessageCopied() {
  capture("message_copied");
}

export function trackMessagePinned(properties: { messageId: string }) {
  capture("message_pinned", properties);
}

export function trackMessageUnpinned(properties: { messageId: string }) {
  capture("message_unpinned", properties);
}

export function trackResponseStopped() {
  capture("response_stopped");
}

export function trackFileUploaded(properties: { mimeType: string; count: number }) {
  capture("file_uploaded", properties);
}

export function trackChatBlocked(properties: { projectId: string }) {
  capture("chat_blocked", properties);
}

// ─── Decisions ──────────────────────────────────────────────────────────

export function trackDecisionCreated(properties: { decisionId: string; title: string; projectId?: string }) {
  capture("decision_created", properties);
}

export function trackDecisionResolved(properties: { decisionId: string; title?: string }) {
  capture("decision_resolved", properties);
}

export function trackDecisionReopened(properties: { decisionId: string }) {
  capture("decision_reopened", properties);
}

export function trackDecisionArchived(properties: { decisionId: string }) {
  capture("decision_archived", properties);
}

export function trackDecisionRevisited(properties: { decisionId: string; status: string }) {
  capture("decision_revisited", properties);
}

// ─── Debates ────────────────────────────────────────────────────────────

export function trackDebateStarted(properties: { projectId: string }) {
  capture("debate_started", properties);
}

export function trackDebateCompleted(properties: { projectId: string; turnCount: number }) {
  capture("debate_completed", properties);
}

export function trackDecideClicked(properties: { projectId: string }) {
  capture("decide_clicked", properties);
}

export function trackDissectClicked(properties: { projectId: string }) {
  capture("dissect_clicked", properties);
}

// ─── Billing & Payments ─────────────────────────────────────────────────

export function trackCardAdded(properties: { brand?: string; last4?: string; source: string }) {
  capture("card_added", properties);
}

export function trackCardRemoved(properties: { cardId: string }) {
  capture("card_removed", properties);
}

export function trackCardDefaultChanged(properties: { cardId: string }) {
  capture("card_default_changed", properties);
}

export function trackCardAssignedToWorkspace(properties: { projectId: string }) {
  capture("card_assigned_to_workspace", properties);
}

export function trackSettlementInitiated(properties: { amount: number; projectId?: string }) {
  capture("settlement_initiated", properties);
}

export function trackSettlementCompleted(properties: { amount: number; projectId?: string }) {
  capture("settlement_completed", properties);
}

export function trackSettlementFailed(properties: { amount: number; error?: string; projectId?: string }) {
  capture("settlement_failed", properties);
}

export function trackSpendLimitUpdated(properties: {
  field: string;
  value: number | null;
  projectId?: string;
}) {
  capture("spend_limit_updated", properties);
}

export function trackPerTxnLimitHit(properties: {
  projectId: string;
  limit: number;
  actualCost: number;
  model: string;
}) {
  capture("per_txn_limit_hit", properties);
}

// ─── Connectors & OAuth ─────────────────────────────────────────────────

export function trackConnectorInitiated(properties: { provider: string; method?: string }) {
  capture("connector_initiated", properties);
}

export function trackConnectorConnected(properties: { provider: string }) {
  capture("connector_connected", properties);
}

export function trackConnectorDisconnected(properties: { provider: string }) {
  capture("connector_disconnected", properties);
}

// ─── Artifacts ──────────────────────────────────────────────────────────

export function trackArtifactGenerated(properties?: { projectId?: string }) {
  capture("artifact_generated", properties);
}

export function trackArtifactRegenerated(properties: { filePath: string; projectId?: string }) {
  capture("artifact_regenerated", properties);
}

export function trackArtifactPushed(properties: { repo: string; artifactCount?: number; projectId?: string }) {
  capture("artifact_pushed", properties);
}

// ─── Commit / Staging ────────────────────────────────────────────────────

export function trackDecisionStaged(properties: { decisionId: string; title: string; projectId?: string }) {
  capture("decision_staged", properties);
}

export function trackDecisionUnstaged(properties: { decisionId: string }) {
  capture("decision_unstaged", properties);
}

export function trackCommitExecuted(properties: { decisionCount: number; artifactCount: number; projectId?: string }) {
  capture("commit_executed", properties);
}

export function trackCommitDropdownOpened(properties?: Record<string, unknown>) {
  capture("commit_dropdown_opened", properties);
}

// ─── Model ──────────────────────────────────────────────────────────────

export function trackModelSelected(properties: { model: string; previousModel?: string }) {
  capture("model_selected", properties);
}

// ─── UI & Navigation ────────────────────────────────────────────────────

export function trackInspectorToggled(properties: { open: boolean }) {
  capture("inspector_toggled", properties);
}

export function trackInspectorTabChanged(properties: { tab: string }) {
  capture("inspector_tab_changed", properties);
}

export function trackThemeChanged(properties: { theme: string }) {
  capture("theme_changed", properties);
}

export function trackCommandBarToggled(properties: { open: boolean }) {
  capture("command_bar_toggled", properties);
}

export function trackSlashCommandUsed(properties: { command: string }) {
  capture("slash_command_used", properties);
}

export function trackOnboardingStepViewed(properties: { step: string }) {
  capture("onboarding_step_viewed", properties);
}
