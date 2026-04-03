import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase";
import { requireAuth } from "@/lib/auth";

/**
 * GET /api/chat/resume?messageId=xxx
 *
 * Reconnects a client to an in-progress server-side stream after page refresh.
 * Polls the DB for content updates (written by the chat route's periodic partial
 * saves) and sends deltas as SSE events until the message reaches "metered" status.
 *
 * On Cloudflare Workers the server-side stream is killed when the client
 * disconnects, so the message will never reach "metered" on its own.  If
 * content stops growing for several consecutive polls we treat the stream as
 * dead, finalize the message in the DB ourselves, and send the usage event so
 * the client can close cleanly.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { userId } = auth;

  const messageId = req.nextUrl.searchParams.get("messageId");
  if (!messageId) {
    return NextResponse.json({ error: "Missing messageId" }, { status: 400 });
  }

  const encoder = new TextEncoder();
  let lastContentLength = 0;
  let lastThinkingLength = 0;
  let attempts = 0;
  // Reduced from 150 — on Cloudflare the stream is already dead, so waiting
  // 75 seconds is pointless.  6 stale polls × 500ms = 3 seconds of grace.
  const MAX_ATTEMPTS = 30;
  // How many consecutive polls with no content change before we declare the
  // stream dead and finalize.
  const STALE_THRESHOLD = 6;
  let stalePollCount = 0;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          /* client closed */
        }
      };

      const supabase = getSupabaseServer();

      // Verify the message belongs to this user (via session ownership)
      const { data: msg } = await supabase
        .from("chat_messages")
        .select("session_id")
        .eq("id", messageId)
        .single();

      if (msg) {
        const { data: sess } = await supabase
          .from("chat_sessions")
          .select("user_id")
          .eq("id", msg.session_id)
          .single();

        if (!sess || sess.user_id !== userId) {
          send({ type: "error", code: "unauthorized" });
          try { controller.close(); } catch { /* */ }
          return;
        }
      }

      /** Send usage + traces + done for the given DB row and return true. */
      const sendFinalEvents = (row: Record<string, unknown>) => {
        send({
          type: "usage",
          tokensIn: row.tokens_in,
          tokensOut: row.tokens_out,
          cacheCreationTokens: row.cache_creation_tokens,
          cacheReadTokens: row.cache_read_tokens,
          cost: row.cost,
        });

        if (row.debate_trace) {
          const trace = row.debate_trace as { model: string; phase: string; content: string }[];
          for (const turn of trace) {
            send({ type: "debate_turn_start", model: turn.model, phase: turn.phase });
            send({ type: "debate_turn_delta", content: turn.content });
            send({ type: "debate_turn_end" });
          }
        }
        if (row.dissector_trace) {
          const trace = row.dissector_trace as { persona: string; content: string }[];
          for (const turn of trace) {
            send({ type: "dissector_turn_start", persona: turn.persona });
            send({ type: "dissector_turn_delta", content: turn.content });
            send({ type: "dissector_turn_end" });
          }
        }

        send({ type: "done", actualModel: row.model ?? "unknown" });
      };

      const poll = async (): Promise<boolean> => {
        const { data: rawRow } = await supabase
          .from("chat_messages")
          .select(
            "content, thinking, receipt_status, model, tokens_in, tokens_out, " +
            "cache_creation_tokens, cache_read_tokens, cost, debate_trace, " +
            "dissector_trace, documents"
          )
          .eq("id", messageId)
          .single();

        if (!rawRow) return false; // Message not in DB yet — keep waiting

        const row = rawRow as Record<string, unknown>;

        // Send thinking deltas
        const thinking = (row.thinking as string) || "";
        if (thinking.length > lastThinkingLength) {
          send({
            type: "thinking_delta",
            content: thinking.slice(lastThinkingLength),
          });
          lastThinkingLength = thinking.length;
        }

        // Send content deltas
        const content = (row.content as string) || "";
        if (content.length > lastContentLength) {
          send({
            type: "delta",
            content: content.slice(lastContentLength),
          });
          stalePollCount = 0; // content is still growing
          lastContentLength = content.length;
        } else {
          // No new content since last poll
          stalePollCount++;
        }

        // Stream completed normally
        if (row.receipt_status === "metered") {
          sendFinalEvents(row);
          return true;
        }

        // Detect dead stream: content hasn't grown for STALE_THRESHOLD
        // consecutive polls.  On Cloudflare Workers the server-side stream
        // dies with the client, so "metered" will never arrive.  Finalize
        // the message in the DB so future refreshes don't re-trigger.
        if (stalePollCount >= STALE_THRESHOLD && row.receipt_status === "metering") {
          await supabase
            .from("chat_messages")
            .update({ receipt_status: "metered" })
            .eq("id", messageId);

          sendFinalEvents(row);
          return true;
        }

        return false;
      };

      // Poll loop — check DB every 500ms for content updates
      while (attempts < MAX_ATTEMPTS) {
        try {
          if (req.signal.aborted) break;
          const done = await poll();
          if (done) break;
        } catch {
          // DB read error — continue polling
        }
        attempts++;
        await new Promise((r) => setTimeout(r, 500));
      }

      // Timeout — finalize with whatever data exists in the DB
      if (attempts >= MAX_ATTEMPTS) {
        // One last attempt to read and send usage data
        try {
          const { data: rawRow } = await supabase
            .from("chat_messages")
            .select(
              "content, thinking, receipt_status, model, tokens_in, tokens_out, " +
              "cache_creation_tokens, cache_read_tokens, cost, debate_trace, " +
              "dissector_trace, documents"
            )
            .eq("id", messageId)
            .single();

          if (rawRow) {
            const row = rawRow as Record<string, unknown>;
            // Mark as metered so future refreshes don't re-trigger
            if (row.receipt_status === "metering") {
              await supabase
                .from("chat_messages")
                .update({ receipt_status: "metered" })
                .eq("id", messageId);
            }
            sendFinalEvents(row);
          } else {
            send({ type: "done", actualModel: "unknown" });
          }
        } catch {
          send({ type: "done", actualModel: "unknown" });
        }
      }

      try {
        controller.close();
      } catch {
        /* already closed */
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
