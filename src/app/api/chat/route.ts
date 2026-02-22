import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { getToolsForConnectors, buildSystemPrompt, executeTool } from "@/lib/tools";
import { streamWithFallback, type Send } from "@/lib/fallback";
import { runDebate } from "@/lib/debate";
import { getSupabaseServer } from "@/lib/supabase";
import { requireAuth, isSuperAdmin } from "@/lib/auth";
import type OpenAI from "openai";

type Message = OpenAI.Chat.ChatCompletionMessageParam;

const MAX_TOOL_ROUNDS = 5;
/** Max tokens of conversation history to send (excluding system prompt).
 *  Keeps costs predictable — a 30k token context costs ~$0.30 for Opus input (at 2x markup). */
const MAX_CONTEXT_TOKENS = 30_000;

export async function POST(req: NextRequest) {
  // At least one provider must be configured
  if (!process.env.OPENROUTER_API_KEY && !process.env.CLAUDE_API_KEY && !process.env.OPENAI_API_KEY && !process.env.GEMINI_API_KEY) {
    return new Response(
      JSON.stringify({ error: "No API keys configured" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { userId } = auth;

  try {
    const { messages, model, projectId, connectedServices, assistantMessageId } = await req.json();

    // Server-side spend limit + exposure cap enforcement (skip for superadmin)
    if (projectId && !(await isSuperAdmin(userId))) {
      const limitCheck = await checkSpendLimits(userId, projectId);
      if (limitCheck) {
        return new Response(
          JSON.stringify({ error: limitCheck }),
          { status: 429, headers: { "Content-Type": "application/json" } }
        );
      }
      const capCheck = await checkExposureCap(userId, projectId);
      if (capCheck) {
        return new Response(
          JSON.stringify({ error: capCheck }),
          { status: 429, headers: { "Content-Type": "application/json" } }
        );
      }
    }

    const connectedIds: string[] = Array.isArray(connectedServices) ? connectedServices : [];
    const resolvedModel = !model || model === "auto" ? "anthropic/claude-sonnet-4.6" : model;
    const encoder = new TextEncoder();
    const tools = getToolsForConnectors(connectedIds);
    const systemPrompt = buildSystemPrompt(connectedIds);

    // Build conversation with context window management.
    const allUserMessages: Message[] = messages.map((m: { role: string; content: string }) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    const conversation: Message[] = [
      { role: "system", content: systemPrompt },
      ...trimConversation(allUserMessages, MAX_CONTEXT_TOKENS),
    ];

    // ─── Producer-consumer pattern ──────────────────────────────────
    // AI work (producer) runs independently of the client connection.
    // The ReadableStream (consumer) drains an event queue.
    // If the client disconnects, cancel() fires but the AI keeps going.
    // after() ensures the serverless function stays alive.

    const eventQueue: Uint8Array[] = [];
    let producerDone = false;
    let clientDisconnected = false;
    let consumerWaiting: (() => void) | null = null;

    // Wake the consumer when new events are available
    const notify = () => {
      if (consumerWaiting) {
        consumerWaiting();
        consumerWaiting = null;
      }
    };

    // ─── AI Producer ──────────────────────────────────────────────
    let serverFullContent = "";
    let activeModel = resolvedModel;
    let cumulativeTokensIn = 0;
    let cumulativeTokensOut = 0;
    let cumulativeCacheCreation = 0;
    let cumulativeCacheRead = 0;

    const aiPromise = (async () => {
      const pushEvent = (data: Record<string, unknown>) => {
        eventQueue.push(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        notify();
      };

      // ── Meter 1.0 Debate Mode ──────────────────────────────────
      if (resolvedModel === "meter-1.0") {
        try {
          await runDebate(conversation, pushEvent);
        } catch (err) {
          console.error("[chat] debate failed:", (err as Error).message);
          pushEvent({ type: "error", code: "debate_failed", model: "meter-1.0" });
          pushEvent({ type: "done", actualModel: "meter-1.0" });
        }
        return;
      }

      // ── Standard single-model flow ─────────────────────────────
      const totalTokensOut = { value: 0 };
      let roundTokensIn = 0;
      let roundTokensOut = 0;
      let roundCacheCreation = 0;
      let roundCacheRead = 0;
      let roundCacheReadRate = 0;

      const roundSend: Send = (data) => {
        if (data.type === "usage") {
          roundTokensIn = (data.tokensIn as number) || 0;
          roundTokensOut = (data.tokensOut as number) || 0;
          roundCacheCreation = (data.cacheCreationTokens as number) || 0;
          roundCacheRead = (data.cacheReadTokens as number) || 0;
          if (data.cacheReadRate) roundCacheReadRate = data.cacheReadRate as number;
          return;
        }
        if (data.type === "delta" && typeof data.content === "string") {
          serverFullContent += data.content;
        }
        pushEvent(data);
      };

      try {
        for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
          roundTokensIn = 0;
          roundTokensOut = 0;
          roundCacheCreation = 0;
          roundCacheRead = 0;
          roundCacheReadRate = 0;

          const result = await streamWithFallback(
            activeModel,
            conversation,
            tools,
            roundSend,
            estimateTokens,
            totalTokensOut,
          );

          cumulativeTokensIn += roundTokensIn;
          cumulativeTokensOut += roundTokensOut;
          cumulativeCacheCreation += roundCacheCreation;
          cumulativeCacheRead += roundCacheRead;

          activeModel = result.actualModel;

          if (!result.hasToolCalls || result.toolCalls.size === 0) break;

          conversation.push({
            role: "assistant",
            content: result.textContent || null,
            tool_calls: Array.from(result.toolCalls.values()).map((tc) => ({
              id: tc.id,
              type: "function" as const,
              function: { name: tc.name, arguments: tc.arguments },
            })),
          });

          for (const tc of result.toolCalls.values()) {
            pushEvent({ type: "tool_call", name: tc.name });

            let args: Record<string, unknown> = {};
            try {
              args = JSON.parse(tc.arguments);
            } catch {
              // malformed args — pass empty
            }

            const toolResult = await executeTool(tc.name, args, { userId, projectId, workspaceId: projectId });

            const toolResultEvent: Record<string, unknown> = { type: "tool_result", name: tc.name };
            if (tc.name === "save_decision") {
              toolResultEvent.decision = {
                title: args.title,
                status: "decided",
                choice: args.choice,
                alternatives: args.alternatives || [],
                reasoning: args.reasoning || null,
              };
            }
            pushEvent(toolResultEvent);

            conversation.push({
              role: "tool",
              tool_call_id: tc.id,
              content: toolResult,
            });
          }
        }
      } catch (err) {
        console.error("[chat] all providers failed:", (err as Error).message);
        pushEvent({
          type: "error",
          code: "all_providers_failed",
          model: resolvedModel,
        });
      }

      // Send aggregated usage
      if (cumulativeTokensIn > 0 || cumulativeTokensOut > 0) {
        pushEvent({
          type: "usage",
          tokensIn: cumulativeTokensIn,
          tokensOut: cumulativeTokensOut,
          cacheCreationTokens: cumulativeCacheCreation || undefined,
          cacheReadTokens: cumulativeCacheRead || undefined,
          cacheReadRate: roundCacheReadRate || undefined,
        });
      }

      pushEvent({ type: "done", actualModel: activeModel });
    })();

    // ─── Client Stream (consumer) ─────────────────────────────────
    const stream = new ReadableStream({
      async pull(controller) {
        // Wait for events if queue is empty and producer isn't done
        while (eventQueue.length === 0 && !producerDone) {
          await new Promise<void>((resolve) => { consumerWaiting = resolve; });
          // If cancelled while waiting, exit
          if (clientDisconnected) return;
        }

        // Drain all available events
        while (eventQueue.length > 0) {
          try {
            controller.enqueue(eventQueue.shift()!);
          } catch {
            // Stream cancelled mid-drain
            clientDisconnected = true;
            return;
          }
        }

        if (producerDone && eventQueue.length === 0) {
          try { controller.close(); } catch { /* already closed */ }
        }
      },
      cancel() {
        clientDisconnected = true;
        // Wake any pending pull() so it can exit
        notify();
      },
    });

    // ─── Background completion ────────────────────────────────────
    // Keep the serverless function alive until the AI finishes.
    // If the client disconnected, save the completed response to DB.
    after(async () => {
      try {
        await aiPromise;
      } catch (err) {
        console.error("[chat/after] AI work failed:", err);
      } finally {
        producerDone = true;
        notify();
      }

      if (clientDisconnected && serverFullContent && assistantMessageId && projectId) {
        try {
          const supabase = getSupabaseServer();
          const dbSessionId = projectId.startsWith(`${userId}:`) ? projectId : `${userId}:${projectId}`;

          await supabase.from("chat_messages").upsert({
            id: assistantMessageId,
            session_id: dbSessionId,
            role: "assistant",
            content: serverFullContent,
            model: activeModel,
            tokens_in: cumulativeTokensIn || null,
            tokens_out: cumulativeTokensOut || null,
            receipt_status: "server_completed",
            timestamp: Date.now(),
          }, { onConflict: "id" });

          console.log(`[chat/after] saved background-completed response (${serverFullContent.length} chars, model=${activeModel})`);
        } catch (dbErr) {
          console.error("[chat/after] failed to save:", dbErr);
        }
      }
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (err) {
    console.error("[/api/chat]", err);
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Trim conversation to fit within a token budget.
 * Always keeps the last message (the current user turn) and as many recent
 * messages as possible. Drops older messages from the front.
 */
function trimConversation(messages: Message[], maxTokens: number): Message[] {
  if (messages.length === 0) return messages;

  // Estimate tokens for each message
  const tokenCounts = messages.map((m) => {
    const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "");
    return estimateTokens(content) + 4; // overhead for role/formatting
  });

  const totalTokens = tokenCounts.reduce((sum, t) => sum + t, 0);
  if (totalTokens <= maxTokens) return messages;

  // Keep messages from the end until we exceed the budget
  let budget = maxTokens;
  let startIdx = messages.length;

  for (let i = messages.length - 1; i >= 0; i--) {
    if (budget - tokenCounts[i] < 0 && i < messages.length - 1) break;
    budget -= tokenCounts[i];
    startIdx = i;
  }

  return messages.slice(startIdx);
}

async function checkSpendLimits(userId: string, projectId: string): Promise<string | null> {
  try {
    const supabase = getSupabaseServer();
    const scopedId = projectId.startsWith(`${userId}:`) ? projectId : `${userId}:${projectId}`;
    const { data: session } = await supabase
      .from("chat_sessions")
      .select("daily_limit, monthly_limit, today_cost, total_cost")
      .eq("id", scopedId)
      .eq("user_id", userId)
      .single();

    if (!session) return null;
    const dailyLimit = session.daily_limit != null ? Number(session.daily_limit) : null;
    const monthlyLimit = session.monthly_limit != null ? Number(session.monthly_limit) : null;
    if (dailyLimit === null && monthlyLimit === null) return null;

    if (dailyLimit !== null) {
      const todayCost = Number(session.today_cost) || 0;
      if (todayCost >= dailyLimit) {
        return `Daily spend limit reached ($${todayCost.toFixed(2)} / $${dailyLimit.toFixed(2)})`;
      }
    }

    if (monthlyLimit !== null) {
      const totalCost = Number(session.total_cost) || 0;
      if (totalCost >= monthlyLimit) {
        return `Monthly spend limit reached ($${totalCost.toFixed(2)} / $${monthlyLimit.toFixed(2)})`;
      }
    }

    return null;
  } catch {
    return null;
  }
}

async function checkExposureCap(userId: string, projectId: string): Promise<string | null> {
  try {
    const supabase = getSupabaseServer();
    const scopedId = projectId.startsWith(`${userId}:`) ? projectId : `${userId}:${projectId}`;

    // Only enforce caps after a failed settlement
    const { data: session } = await supabase
      .from("chat_sessions")
      .select("settlement_failed")
      .eq("id", scopedId)
      .eq("user_id", userId)
      .single();

    if (!session?.settlement_failed) return null;

    // Count successful settlements to determine trust tier
    const { count } = await supabase
      .from("settlement_history")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("status", "succeeded");

    const successes = count ?? 0;
    const cap = successes === 0 ? 20 : successes <= 2 ? 100 : 250;

    // Calculate outstanding from unsettled messages
    const { data: unsettled } = await supabase
      .from("chat_messages")
      .select("cost")
      .eq("session_id", scopedId)
      .eq("settled", false)
      .not("cost", "is", null);

    const outstanding = (unsettled ?? []).reduce((sum, m) => sum + (Number(m.cost) || 0), 0);

    if (outstanding >= cap) {
      return `Outstanding balance ($${outstanding.toFixed(2)}) exceeds limit ($${cap}). Please update your payment method to continue.`;
    }
    return null;
  } catch {
    return null;
  }
}
