/**
 * Utility for emitting events to the public development log.
 * Called from client-side stores after actions (decision locked, debate started, etc.).
 */
import { apiUrl } from "@/lib/api-url";

export type LogEventType =
  | "message_sent"
  | "decision_locked"
  | "debate_started"
  | "path_forked"
  | "path_merged"
  | "workspace_created"
  | "feedback_logged"
  | "commit_pushed";

/** Hash a user ID to a short anonymous identifier (first 6 hex chars) */
async function hashUserId(userId: string): Promise<string> {
  if (typeof window === "undefined" || !window.crypto?.subtle) {
    // Fallback: simple hash for non-browser environments
    let h = 0;
    for (let i = 0; i < userId.length; i++) {
      h = (Math.imul(31, h) + userId.charCodeAt(i)) | 0;
    }
    return Math.abs(h).toString(16).slice(0, 6);
  }
  const data = new TextEncoder().encode(userId);
  const hash = await window.crypto.subtle.digest("SHA-256", data);
  const arr = new Uint8Array(hash);
  return Array.from(arr.slice(0, 3))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Emit a log event. Fire-and-forget — never blocks the caller. */
export function emitLogEvent(
  type: LogEventType,
  userId?: string | null,
  extra?: { feedbackText?: string; preview?: string }
) {
  (async () => {
    try {
      const actor = userId ? await hashUserId(userId) : "anon";
      await fetch(apiUrl("/api/log"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          actor,
          feedbackText: extra?.feedbackText,
          preview: extra?.preview,
        }),
      });
    } catch {
      // Silent fail — log events are non-critical
    }
  })();
}
