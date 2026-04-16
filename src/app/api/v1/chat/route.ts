import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase";
import OpenAI from "openai";
import { TOOL_DEFINITIONS, SYSTEM_PROMPT, executeTool } from "@/lib/tools";
import { serverTrackApiV1Request } from "@/lib/analytics-server";
import { resolveEndUser } from "@/lib/sdk-users";
import { authenticateApiKey } from "@/lib/api-auth";

function getOpenRouterClient() {
  return new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: "https://openrouter.ai/api/v1",
  });
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

type Message = OpenAI.Chat.ChatCompletionMessageParam;

const MAX_TOOL_ROUNDS = 5;

export async function POST(req: NextRequest) {
  const keyRecord = await authenticateApiKey(req);
  if (!keyRecord) {
    return NextResponse.json(
      { error: "Invalid or missing API key" },
      { status: 401 }
    );
  }

  const body = await req.json();
  const { messages, model, endUserId } = body;
  const resolvedModel = model || "anthropic/claude-opus-4.7";
  const openrouter = getOpenRouterClient();
  const encoder = new TextEncoder();
  const supabase = getSupabaseServer();
  const developerId = keyRecord.user_id;
  const keyId = keyRecord.id;

  // If endUserId is provided, resolve to internal SDK user (for embedded SDK)
  // Otherwise fall back to the developer's own user ID (direct API usage)
  const userId = endUserId
    ? await resolveEndUser(developerId, endUserId)
    : developerId;

  const conversation: Message[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...messages.map((m: { role: string; content: string }) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
  ];

  const stream = new ReadableStream({
    async start(controller) {
      let totalTokensOut = 0;
      let finalTokensIn = 0;
      let finalTokensOut = 0;

      try {
        for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
          const response = await openrouter.chat.completions.create({
            model: resolvedModel,
            messages: conversation,
            tools: TOOL_DEFINITIONS,
            stream: true,
            stream_options: { include_usage: true },
          });

          let textContent = "";
          const toolCalls = new Map<
            number,
            { id: string; name: string; arguments: string }
          >();
          let hasToolCalls = false;

          for await (const chunk of response) {
            const choice = chunk.choices?.[0];
            if (!choice) {
              if (chunk.usage) {
                finalTokensIn = chunk.usage.prompt_tokens;
                finalTokensOut = chunk.usage.completion_tokens;
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({ type: "usage", tokensIn: finalTokensIn, tokensOut: finalTokensOut })}\n\n`
                  )
                );
              }
              continue;
            }

            const delta = choice.delta?.content || "";
            if (delta) {
              textContent += delta;
              totalTokensOut += estimateTokens(delta);
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ type: "delta", content: delta, tokensOut: totalTokensOut })}\n\n`
                )
              );
            }

            if (choice.delta?.tool_calls) {
              hasToolCalls = true;
              for (const tc of choice.delta.tool_calls) {
                const existing = toolCalls.get(tc.index) || { id: "", name: "", arguments: "" };
                if (tc.id) existing.id = tc.id;
                if (tc.function?.name) existing.name = tc.function.name;
                if (tc.function?.arguments) existing.arguments += tc.function.arguments;
                toolCalls.set(tc.index, existing);
              }
            }

            if (chunk.usage) {
              finalTokensIn = chunk.usage.prompt_tokens;
              finalTokensOut = chunk.usage.completion_tokens;
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ type: "usage", tokensIn: finalTokensIn, tokensOut: finalTokensOut })}\n\n`
                )
              );
            }
          }

          if (!hasToolCalls || toolCalls.size === 0) break;

          conversation.push({
            role: "assistant",
            content: textContent || null,
            tool_calls: Array.from(toolCalls.values()).map((tc) => ({
              id: tc.id,
              type: "function" as const,
              function: { name: tc.name, arguments: tc.arguments },
            })),
          });

          for (const tc of toolCalls.values()) {
            let args: Record<string, unknown> = {};
            try {
              args = JSON.parse(tc.arguments);
            } catch {
              // malformed args
            }
            const result = await executeTool(tc.name, args, { userId });
            conversation.push({
              role: "tool",
              tool_call_id: tc.id,
              content: result,
            });
          }
        }
      } catch (err) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: "error", message: (err as Error).message })}\n\n`
          )
        );
      }

      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ type: "done" })}\n\n`)
      );
      controller.close();

      // Record usage asynchronously
      await supabase.from("usage_records").insert({
        user_id: userId,
        api_key_id: keyId,
        model: resolvedModel,
        input_tokens: finalTokensIn,
        output_tokens: finalTokensOut,
      });

      serverTrackApiV1Request(userId, {
        apiKeyId: keyId,
        model: resolvedModel,
        tokensIn: finalTokensIn,
        tokensOut: finalTokensOut,
      });
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
