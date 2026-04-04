import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase";
import { requireAuth } from "@/lib/auth";

/**
 * GET /api/chat/resume?messageId=xxx
 *
 * Reconnects a client to an in-progress server-side stream after page refresh.
 * On Vercel the server-side function keeps running after client disconnect
 * (up to maxDuration), so the message will eventually reach "metered" status.
 * This endpoint polls the DB for content updates (written by the chat route's
 * periodic partial saves) and sends deltas as SSE events until completion.
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
  // 150 polls × 500ms = 75 seconds.  On Vercel the server-side stream
  // continues after disconnect (up to 300s via maxDuration), so we need
  // to be patient — the final "metered" save will arrive.
  const MAX_ATTEMPTS = 150;

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

      /** Send usage + traces + done for the given DB row. */
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
          lastContentLength = content.length;
        }

        // Stream completed — send final usage and close
        if (row.receipt_status === "metered") {
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

      // Timeout — send whatever data exists so the client can finalize
      if (attempts >= MAX_ATTEMPTS) {
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
            // If still "metering" after 75 seconds, the server function likely
            // timed out.  Mark as metered so future refreshes don't retrigger.
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
