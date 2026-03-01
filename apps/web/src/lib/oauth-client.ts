/* ─── Client-side OAuth helpers (no secrets) ──────────────────── */

import { CONNECTORS } from "@/lib/connectors";

export function isApiKeyProvider(providerId: string): boolean {
  const connector = CONNECTORS.find((c) => c.id === providerId);
  return connector?.connectionType === "api_key";
}

export function initiateOAuthFlow(providerId: string, workspaceId: string) {
  window.location.href = `/api/oauth/${providerId}/authorize?workspaceId=${encodeURIComponent(workspaceId)}`;
}
