import { NextRequest, NextResponse } from "next/server";
import { getToolsForConnectors, buildSystemPrompt, executeTool } from "@/lib/tools";
import { streamWithFallback, type Send } from "@/lib/fallback";
import { runDebate } from "@/lib/debate";
import { runDissection } from "@/lib/dissect";
import { getSupabaseServer } from "@/lib/supabase";
import { getModel } from "@/lib/models";
import { requireAuth, isSuperAdmin } from "@/lib/auth";
import {
  serverTrackChatCompleted,
  serverTrackChatFailed,
  serverTrackModelRerouted,
  serverTrackSpendLimitHit,
  serverTrackExposureCapHit,
  serverTrackDecisionSaved,
} from "@/lib/analytics-server";
import type OpenAI from "openai";

type Message = OpenAI.Chat.ChatCompletionMessageParam;

const MAX_TOOL_ROUNDS = 5;
/** Max tokens of conversation history to send (excluding system prompt).
 *  Keeps costs predictable — a 30k token context costs ~$0.15 for Opus input (at 1x / at-cost). */
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
    const body = await req.json();
    const { messages, model, connectedServices, attachments, debateRoster, userMessageId, assistantMessageId, appMode } = body;
    // Accept both sessionId (new) and projectId (legacy) for backward compatibility
    const projectId: string | undefined = body.sessionId ?? body.projectId;

    // Server-side spend limit + exposure cap enforcement (skip for superadmin)
    if (projectId && !(await isSuperAdmin(userId))) {
      const limitCheck = await checkSpendLimits(userId, projectId);
      if (limitCheck) {
        serverTrackSpendLimitHit(userId, {
          projectId,
          limitType: limitCheck.includes("Daily") ? "daily" : "monthly",
          currentSpend: 0,
          limit: 0,
        });
        return new Response(
          JSON.stringify({ error: limitCheck }),
          { status: 429, headers: { "Content-Type": "application/json" } }
        );
      }
      const capCheck = await checkExposureCap(userId, projectId);
      if (capCheck) {
        serverTrackExposureCapHit(userId, {
          projectId,
          outstanding: 0,
          cap: 0,
        });
        return new Response(
          JSON.stringify({ error: capCheck }),
          { status: 429, headers: { "Content-Type": "application/json" } }
        );
      }
    }

    const connectedIds: string[] = Array.isArray(connectedServices) ? connectedServices : [];
    const resolvedModel = !model || model === "auto" ? "openai/gpt-5.2" : model;
    const encoder = new TextEncoder();
    const tools = getToolsForConnectors(connectedIds);
    const systemPrompt = buildSystemPrompt(connectedIds, appMode === "metric" ? "metric" : "meter");

    // Build conversation with context window management.
    // Cap input context to avoid sending 100k+ tokens of history on every call.
    const allUserMessages: Message[] = messages.map((m: { role: string; content: string }) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    const trimmed = trimConversation(allUserMessages, MAX_CONTEXT_TOKENS);

    // If attachments were provided, make the last user message multimodal
    const parsedAttachments: { url: string; mimeType: string; name: string }[] =
      Array.isArray(attachments) ? attachments : [];

    if (parsedAttachments.length > 0 && trimmed.length > 0) {
      const lastIdx = trimmed.length - 1;
      const last = trimmed[lastIdx];
      if (last.role === "user") {
        const contentParts: OpenAI.Chat.ChatCompletionContentPart[] = [];
        if (typeof last.content === "string" && last.content) {
          contentParts.push({ type: "text", text: last.content });
        }
        for (const att of parsedAttachments) {
          if (att.mimeType.startsWith("image/")) {
            // Fetch and encode as base64 data URL so all providers can see it
            // (some providers can't fetch arbitrary URLs server-side)
            try {
              const imgRes = await fetch(att.url);
              const imgBuf = Buffer.from(await imgRes.arrayBuffer());
              const imgB64 = imgBuf.toString("base64");
              contentParts.push({
                type: "image_url",
                image_url: { url: `data:${att.mimeType};base64,${imgB64}` },
              });
            } catch {
              // Fall back to direct URL if fetch fails
              contentParts.push({ type: "image_url", image_url: { url: att.url } });
            }
          } else if (att.mimeType === "application/pdf") {
            // For PDF: fetch and encode as base64 data URL for providers that support it.
            // Include a text fallback description for providers that don't.
            try {
              const pdfRes = await fetch(att.url);
              const pdfBuf = Buffer.from(await pdfRes.arrayBuffer());
              const pdfB64 = pdfBuf.toString("base64");
              contentParts.push({
                type: "image_url",
                image_url: { url: `data:application/pdf;base64,${pdfB64}` },
              });
            } catch {
              contentParts.push({ type: "text", text: `[Attached PDF: ${att.name} — could not load]` });
            }
          }
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        trimmed[lastIdx] = { ...last, content: contentParts as any };
      }
    }

    const conversation: Message[] = [
      { role: "system", content: systemPrompt },
      ...trimmed,
    ];

    // Helper: save a single message to Supabase (fire-and-forget, non-blocking)
    const saveMessageToDB = async (msg: {
      id: string;
      sessionId: string;
      role: string;
      content: string;
      model?: string;
      tokensIn?: number;
      tokensOut?: number;
      cost?: number;
      timestamp: number;
      debateTrace?: unknown;
      dissectorTrace?: unknown;
      thinking?: string;
      receiptStatus?: string;
    }) => {
      try {
        const supabase = getSupabaseServer();
        const dbSessionId = projectId?.startsWith(`${userId}:`) ? projectId : `${userId}:${projectId}`;

        // Compute cost server-side from tokens + model pricing if not provided.
        // This ensures the cost field is populated even if the client disconnects.
        let cost = msg.cost ?? null;
        if (cost == null && msg.model && (msg.tokensIn || msg.tokensOut)) {
          try {
            const modelInfo = getModel(msg.model);
            cost = (msg.tokensIn ?? 0) * modelInfo.inputPrice + (msg.tokensOut ?? 0) * modelInfo.outputPrice;
          } catch { /* unknown model — leave cost null */ }
        }

        await supabase.from("chat_messages").upsert({
          id: msg.id,
          session_id: dbSessionId,
          role: msg.role,
          content: msg.content || "",
          model: msg.model ?? null,
          tokens_in: msg.tokensIn ?? null,
          tokens_out: msg.tokensOut ?? null,
          cost,
          settled: false,
          receipt_status: msg.receiptStatus ?? null,
          debate_trace: msg.debateTrace ?? null,
          dissector_trace: msg.dissectorTrace ?? null,
          thinking: msg.thinking ?? null,
          timestamp: msg.timestamp,
        }, { onConflict: "id" });
      } catch (err) {
        console.warn("[chat] Failed to save message to DB:", err);
      }
    };

    // Save user message to DB immediately (before streaming starts).
    // This ensures the user message survives even if the client disconnects.
    const userContent = messages[messages.length - 1]?.content ?? "";
    if (userMessageId && projectId) {
      await saveMessageToDB({
        id: userMessageId,
        sessionId: projectId,
        role: "user",
        content: typeof userContent === "string" ? userContent : JSON.stringify(userContent),
        timestamp: Date.now(),
      });
    }

    // Track the full assistant response for server-side save after completion
    let fullAssistantContent = "";
    let fullThinkingContent = "";
    // Accumulate debate/dissector traces server-side so they survive page refresh
    const serverDebateTrace: { model: string; phase: string; content: string }[] = [];
    let currentDebateTurn: { model: string; phase: string; content: string } | null = null;
    const serverDissectorTrace: { persona: string; content: string }[] = [];
    let currentDissectorTurn: { persona: string; content: string } | null = null;
    // Track client connection state — when the client disconnects (e.g. page
    // refresh), we keep the upstream API call running and accumulate the full
    // response so we can save it to DB. Only the SSE push is skipped.
    let clientDisconnected = false;

    // Listen for client disconnect via the request's AbortSignal.
    // This is more reliable than ReadableStream.cancel() in Node.js runtime.
    const abortHandler = () => {
      if (!clientDisconnected) {
        clientDisconnected = true;
        // Always save the assistant message on disconnect — even during thinking
        // (empty content). This creates a DB record so the reload refetch can
        // poll for the completed response once the server-side stream finishes.
        if (assistantMessageId && projectId) {
          saveMessageToDB({
            id: assistantMessageId,
            sessionId: projectId,
            role: "assistant",
            content: fullAssistantContent,
            model: resolvedModel,
            receiptStatus: "signing",
            timestamp: Date.now(),
            thinking: fullThinkingContent || undefined,
            debateTrace: serverDebateTrace.length > 0 ? serverDebateTrace : undefined,
            dissectorTrace: serverDissectorTrace.length > 0 ? serverDissectorTrace : undefined,
          }).catch(() => { /* best-effort */ });
        }
      }
    };
    req.signal.addEventListener("abort", abortHandler);

    const stream = new ReadableStream({
      async start(controller) {
        const send: Send = (data) => {
          // Accumulate assistant content BEFORE trying to push to client.
          // This ensures content is captured even if the client is gone.
          if (data.type === "delta" && typeof data.content === "string") {
            fullAssistantContent += data.content;
          }
          if (data.type === "thinking_delta" && typeof data.content === "string") {
            fullThinkingContent += data.content;
          }
          // Accumulate debate trace server-side (survives client disconnect)
          if (data.type === "debate_turn_start") {
            currentDebateTurn = { model: data.model as string, phase: data.phase as string, content: "" };
          } else if (data.type === "debate_turn_delta" && currentDebateTurn) {
            currentDebateTurn.content += data.content as string;
          } else if (data.type === "debate_turn_end" && currentDebateTurn) {
            serverDebateTrace.push({ ...currentDebateTurn });
            currentDebateTurn = null;
          }
          // Accumulate dissector trace server-side
          if (data.type === "dissector_turn_start") {
            currentDissectorTurn = { persona: data.persona as string, content: "" };
          } else if (data.type === "dissector_turn_delta" && currentDissectorTurn) {
            currentDissectorTurn.content += data.content as string;
          } else if (data.type === "dissector_turn_end" && currentDissectorTurn) {
            serverDissectorTrace.push({ ...currentDissectorTurn });
            currentDissectorTurn = null;
          }
          // Try to send to client — if disconnected, just skip silently
          if (!clientDisconnected) {
            try {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
            } catch {
              clientDisconnected = true;
              // Client just disconnected — immediately save partial content to DB
              // so the user sees it on refresh (before the full stream completes).
              if (assistantMessageId && projectId && fullAssistantContent) {
                saveMessageToDB({
                  id: assistantMessageId,
                  sessionId: projectId,
                  role: "assistant",
                  content: fullAssistantContent,
                  model: resolvedModel,
                  receiptStatus: "signing",
                  timestamp: Date.now(),
                  thinking: fullThinkingContent || undefined,
                  debateTrace: serverDebateTrace.length > 0 ? serverDebateTrace : undefined,
                  dissectorTrace: serverDissectorTrace.length > 0 ? serverDissectorTrace : undefined,
                }).catch(() => { /* best-effort */ });
              }
            }
          }
        };

        // ── Debate Mode ──────────────────────────────────────────────
        if (resolvedModel === "debate") {
          try {
            const roster = Array.isArray(debateRoster) && debateRoster.length >= 2
              ? debateRoster as string[]
              : undefined;
            await runDebate(conversation, send, roster);
          } catch (err) {
            console.error("[chat] debate failed:", (err as Error).message);
            send({ type: "error", code: "debate_failed", model: "debate" });
            send({ type: "done", actualModel: "debate" });
          }
          // Save debate assistant message (with trace + cost)
          if (assistantMessageId && projectId && fullAssistantContent) {
            await saveMessageToDB({
              id: assistantMessageId,
              sessionId: projectId,
              role: "assistant",
              content: fullAssistantContent,
              model: "debate",
              receiptStatus: "signed",
              timestamp: Date.now(),
              debateTrace: serverDebateTrace.length > 0 ? serverDebateTrace : undefined,
            });
          }
          if (!clientDisconnected) try { controller.close(); } catch { /* already closed */ }
          return;
        }

        // ── Dissect Mode ──────────────────────────────────────────
        if (resolvedModel === "dissect") {
          try {
            await runDissection(conversation, send);
          } catch (err) {
            console.error("[chat] dissection failed:", (err as Error).message);
            send({ type: "error", code: "dissection_failed", model: "dissect" });
            send({ type: "done", actualModel: "dissect" });
          }
          // Save dissect assistant message (with trace)
          if (assistantMessageId && projectId && fullAssistantContent) {
            await saveMessageToDB({
              id: assistantMessageId,
              sessionId: projectId,
              role: "assistant",
              content: fullAssistantContent,
              model: "dissect",
              receiptStatus: "signed",
              timestamp: Date.now(),
              dissectorTrace: serverDissectorTrace.length > 0 ? serverDissectorTrace : undefined,
            });
          }
          if (!clientDisconnected) try { controller.close(); } catch { /* already closed */ }
          return;
        }

        // ── Standard single-model flow ─────────────────────────────
        const totalTokensOut = { value: 0 };
        let activeModel = resolvedModel;
        let toolRoundCount = 0;
        const toolsUsedSet = new Set<string>();

        // Aggregate API-reported usage across tool rounds instead of
        // only capturing the last round (which under-reports total cost).
        let cumulativeTokensIn = 0;
        let cumulativeTokensOut = 0;
        let cumulativeCacheCreation = 0;
        let cumulativeCacheRead = 0;
        let roundTokensIn = 0;
        let roundTokensOut = 0;
        let roundCacheCreation = 0;
        let roundCacheRead = 0;
        let roundCacheReadRate = 0;

        // Intercept usage events from streaming adapters — accumulate per-round,
        // then sum across rounds. Forward everything else to the client.
        const roundSend: Send = (data) => {
          if (data.type === "usage") {
            roundTokensIn = (data.tokensIn as number) || 0;
            roundTokensOut = (data.tokensOut as number) || 0;
            roundCacheCreation = (data.cacheCreationTokens as number) || 0;
            roundCacheRead = (data.cacheReadTokens as number) || 0;
            if (data.cacheReadRate) roundCacheReadRate = data.cacheReadRate as number;
            return;
          }
          if (data.type === "rerouting") {
            serverTrackModelRerouted(userId, {
              requestedModel: resolvedModel,
              actualModel: data.to as string,
              projectId,
            });
          }
          send(data);
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

            // Accumulate this round's API-reported usage
            cumulativeTokensIn += roundTokensIn;
            cumulativeTokensOut += roundTokensOut;
            cumulativeCacheCreation += roundCacheCreation;
            cumulativeCacheRead += roundCacheRead;

            // Track which model actually responded (for subsequent tool rounds)
            activeModel = result.actualModel;

            // No tool calls → done
            if (!result.hasToolCalls || result.toolCalls.size === 0) break;
            toolRoundCount++;

            // Add assistant message with tool calls to conversation
            conversation.push({
              role: "assistant",
              content: result.textContent || null,
              tool_calls: Array.from(result.toolCalls.values()).map((tc) => ({
                id: tc.id,
                type: "function" as const,
                function: { name: tc.name, arguments: tc.arguments },
              })),
            });

            // Execute each tool call
            for (const tc of result.toolCalls.values()) {
              send({ type: "tool_call", name: tc.name });

              let args: Record<string, unknown> = {};
              try {
                args = JSON.parse(tc.arguments);
              } catch {
                // malformed args — pass empty
              }

              toolsUsedSet.add(tc.name);
              const toolResult = await executeTool(tc.name, args, { userId, sessionId: projectId, workspaceId: projectId });

              const toolResultEvent: Record<string, unknown> = { type: "tool_result", name: tc.name };
              if (tc.name === "save_decision") {
                let serverDecisionId: string | undefined;
                try { serverDecisionId = JSON.parse(toolResult).id; } catch { /* plain text fallback */ }
                toolResultEvent.decision = {
                  id: serverDecisionId,
                  title: args.title,
                  status: "decided",
                  choice: args.choice,
                  alternatives: args.alternatives || [],
                  reasoning: args.reasoning || null,
                };
                if (serverDecisionId) {
                  serverTrackDecisionSaved(userId, {
                    decisionId: serverDecisionId,
                    title: args.title as string,
                    status: "decided",
                    projectId,
                  });
                }
              }
              if (tc.name === "save_artifact") {
                let artifactData: { id?: string; content?: string; category?: string } | undefined;
                try { artifactData = JSON.parse(toolResult); } catch { /* plain text fallback */ }
                toolResultEvent.artifact = {
                  id: artifactData?.id,
                  filePath: args.file_path,
                  content: args.content,
                  category: artifactData?.category || args.category || "other",
                  status: "draft",
                };
              }
              if (tc.name === "fork_paths") {
                toolResultEvent.forkPaths = args.paths;
              }
              if (tc.name === "porkbun_check_domain") {
                try {
                  const domainData = JSON.parse(toolResult);
                  if (domainData.available) {
                    toolResultEvent.domainCard = {
                      id: `dom_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                      type: "domain",
                      title: domainData.domain,
                      description: `Available · .${domainData.tld} · 1yr registration`,
                      cost: parseFloat(domainData.price),
                      status: "pending",
                      metadata: {
                        domain: domainData.domain,
                        tld: domainData.tld,
                        regularPrice: domainData.regularPrice,
                        renewalPrice: domainData.renewalPrice ?? "",
                        premium: String(domainData.premium),
                        available: "true",
                      },
                    };
                  } else {
                    toolResultEvent.domainCard = {
                      id: `dom_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                      type: "domain",
                      title: domainData.domain,
                      description: "This domain is already taken",
                      status: "rejected",
                      metadata: {
                        domain: domainData.domain,
                        tld: domainData.tld,
                        available: "false",
                      },
                    };
                  }
                } catch { /* non-JSON result — skip card */ }
              }
              send(toolResultEvent);

              conversation.push({
                role: "tool",
                tool_call_id: tc.id,
                content: toolResult,
              });
            }
          }
        } catch (err) {
          // All fallback tiers exhausted — show error to client
          console.error("[chat] all providers failed:", (err as Error).message);
          serverTrackChatFailed(userId, {
            model: resolvedModel,
            error: (err as Error).message,
            projectId,
          });

          send({
            type: "error",
            code: "all_providers_failed",
            model: resolvedModel,
          });
        }

        // Track aggregated server-side metrics
        if (cumulativeTokensIn > 0 || cumulativeTokensOut > 0) {
          const isAdmin = await isSuperAdmin(userId);
          serverTrackChatCompleted(userId, {
            model: activeModel,
            requestedModel: resolvedModel,
            projectId,
            tokensIn: cumulativeTokensIn,
            tokensOut: cumulativeTokensOut,
            cacheCreationTokens: cumulativeCacheCreation || undefined,
            cacheReadTokens: cumulativeCacheRead || undefined,
            cacheReadRate: roundCacheReadRate || undefined,
            toolRounds: toolRoundCount,
            toolsUsed: Array.from(toolsUsedSet),
            isDebate: false,
            isSuperAdmin: isAdmin,
          });
        }

        // Send aggregated usage across all tool rounds as a single event
        if (cumulativeTokensIn > 0 || cumulativeTokensOut > 0) {
          send({
            type: "usage",
            tokensIn: cumulativeTokensIn,
            tokensOut: cumulativeTokensOut,
            cacheCreationTokens: cumulativeCacheCreation || undefined,
            cacheReadTokens: cumulativeCacheRead || undefined,
            // Forward the provider-specific cache read rate (last round's rate)
            cacheReadRate: roundCacheReadRate || undefined,
          });
        }

        send({ type: "done", actualModel: activeModel });

        // Save the completed assistant message to DB (server-side persistence).
        // This ensures the response survives even if the client disconnects
        // mid-stream (e.g. page refresh). The upstream API call completes,
        // content is accumulated, and this save captures the full response.
        if (assistantMessageId && projectId && fullAssistantContent) {
          await saveMessageToDB({
            id: assistantMessageId,
            sessionId: projectId,
            role: "assistant",
            content: fullAssistantContent,
            model: activeModel,
            tokensIn: cumulativeTokensIn || undefined,
            tokensOut: cumulativeTokensOut || undefined,
            receiptStatus: "signed",
            timestamp: Date.now(),
            thinking: fullThinkingContent || undefined,
          });
        }

        req.signal.removeEventListener("abort", abortHandler);
        if (!clientDisconnected) try { controller.close(); } catch { /* already closed */ }
      },
      cancel() {
        // Client disconnected (e.g. page refresh). Don't abort the upstream
        // API call — let it finish so we can save the complete response.
        clientDisconnected = true;
        // Always persist to DB (even during thinking with empty content).
        // The final save at stream completion will overwrite with full content.
        if (assistantMessageId && projectId) {
          saveMessageToDB({
            id: assistantMessageId,
            sessionId: projectId,
            role: "assistant",
            content: fullAssistantContent,
            model: resolvedModel,
            receiptStatus: "signing",
            timestamp: Date.now(),
            thinking: fullThinkingContent || undefined,
            debateTrace: serverDebateTrace.length > 0 ? serverDebateTrace : undefined,
            dissectorTrace: serverDissectorTrace.length > 0 ? serverDissectorTrace : undefined,
          }).catch(() => { /* best-effort */ });
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

// NOTE: per_txn_limit is enforced client-side during streaming (see chat-view.tsx).
// Only daily/monthly limits are pre-flight checked here.
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
