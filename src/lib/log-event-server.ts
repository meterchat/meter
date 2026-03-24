/**
 * Server-side utility for emitting events to the public development log.
 * Called from API routes (auth, billing, artifacts, etc.) where
 * the client-side emitLogEvent() cannot reach.
 */
import { getSupabaseServer } from "@/lib/supabase";
import crypto from "crypto";

export type ServerLogEventType =
  | "message_sent"
  | "decision_locked"
  | "debate_started"
  | "debate_completed"
  | "path_forked"
  | "path_merged"
  | "workspace_created"
  | "feedback_logged"
  | "commit_pushed"
  | "payment_succeeded"
  | "payment_failed"
  | "auth_hold_created"
  | "refund_issued"
  | "account_created"
  | "user_logged_in"
  | "account_deleted"
  | "artifacts_pushed"
  | "decision_created"
  | "connector_connected"
  | "card_saved";

function generateId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

/** Hash a user ID to a short anonymous identifier (first 6 hex chars). */
function hashUserId(userId: string): string {
  const hash = crypto.createHash("sha256").update(userId).digest("hex");
  return hash.slice(0, 6);
}

/**
 * Emit a log event from the server. Fire-and-forget — never throws.
 */
export function serverEmitLogEvent(
  type: ServerLogEventType,
  userId?: string | null,
  extra?: { feedbackText?: string; preview?: string },
) {
  const actor = userId ? hashUserId(userId) : "anon";
  const feedbackValue =
    type === "feedback_logged" ? extra?.feedbackText :
    extra?.preview ? String(extra.preview).slice(0, 120) : null;

  const supabase = getSupabaseServer();
  supabase
    .from("log_entries")
    .insert({
      id: generateId(),
      type,
      actor,
      feedback_text: feedbackValue,
    })
    .then(() => {}, (err: unknown) => {
      console.error("Failed to emit server log event:", type, err);
    });
}
