import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase";
import { requireAuth } from "@/lib/auth";

/**
 * GET /api/chat/resume?messageId=xxx
 *
 * Reconnects a client to an in-progress server-side stream after page refresh.
 * Polls the DB for content updates (written by the chat route's periodic partial
 * saves) and sends deltas as SSE events until the message reaches "metered" status.
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
  // 150 polls * 500ms = 75 seconds max wait for stream completion
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

        // Cast to record for property access (Supabase types are dynamic)
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

        // Check if the stream has completed
        if (row.receipt_status === "metered") {
          // Send final usage data so the client can finalize costs
          send({
            type: "usage",
            tokensIn: row.tokens_in,
            tokensOut: row.tokens_out,
            cacheCreationTokens: row.cache_creation_tokens,
            cacheReadTokens: row.cache_read_tokens,
            cost: row.cost,
          });

          // Send debate/dissector traces if present
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

          send({ type: "done", actualModel: row.model });
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

      // Timeout — tell the client to stop waiting
      if (attempts >= MAX_ATTEMPTS) {
        send({ type: "done", actualModel: "unknown" });
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
