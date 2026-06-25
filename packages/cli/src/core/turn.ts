/**
 * The single-model-turn primitive — lifted from Meter's debate.ts (`runModelTurn`)
 * and generalized. This is the metering heart of Meter: every model call (plan,
 * debate turn, candidate generation, test generation, repair) goes through here so
 * cost is accumulated cache-aware against each model's real per-token price.
 *
 * What changed vs. Meter: deltas are delivered through a caller-supplied callback
 * instead of Meter's hardcoded `debate_turn_*` events, and cost lives in a reusable
 * `CostMeter` rather than a per-debate struct.
 */
import { streamWithFallback, type Send as RawSend, type StreamOptions } from "../providers/fallback.ts";
import { getModel } from "../providers/models.ts";
import type { CostSnapshot, Message } from "../types.ts";

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Accumulates token usage and actual $ cost across many model turns. */
export class CostMeter {
  tokensIn = 0;
  tokensOut = 0;
  cacheCreationTokens = 0;
  cacheReadTokens = 0;
  actualCost = 0;

  snapshot(): CostSnapshot {
    return {
      tokensIn: this.tokensIn,
      tokensOut: this.tokensOut,
      cacheCreationTokens: this.cacheCreationTokens,
      cacheReadTokens: this.cacheReadTokens,
      actualCost: this.actualCost,
    };
  }
}

/**
 * Run one model turn: stream it, collect the full text, and price the turn
 * (cache-aware) into the shared meter. `onDelta` receives streamed text chunks.
 *
 * Mirrors Meter's pricing math exactly: cached-creation tokens bill at 1.25×,
 * cache-reads at the provider's discounted rate, the rest at base input price.
 */
export async function runModelTurn(
  modelId: string,
  messages: Message[],
  meter: CostMeter,
  onDelta?: (chunk: string) => void,
  streamOpts?: StreamOptions,
): Promise<string> {
  let content = "";
  let roundIn = 0;
  let roundOut = 0;
  let roundCacheCreation = 0;
  let roundCacheRead = 0;
  let roundCacheReadRate = 0;

  const turnSend: RawSend = (data) => {
    if (data.type === "delta") {
      const chunk = data.content as string;
      content += chunk;
      onDelta?.(chunk);
    }
    if (data.type === "usage") {
      roundIn = (data.tokensIn as number) || 0;
      roundOut = (data.tokensOut as number) || 0;
      roundCacheCreation = (data.cacheCreationTokens as number) || 0;
      roundCacheRead = (data.cacheReadTokens as number) || 0;
      roundCacheReadRate = (data.cacheReadRate as number) || 0;
    }
  };

  const totalOut = { value: 0 };
  const opts: StreamOptions = {
    timeoutMs: 600_000,
    silent: true,
    ...streamOpts,
  };

  try {
    await streamWithFallback(modelId, messages, [], turnSend, estimateTokens, totalOut, opts);
  } catch {
    content = "(This model was unavailable for this turn.)";
  }

  // Price this turn at the model's actual rate, cache-aware.
  const model = getModel(modelId);
  meter.tokensIn += roundIn;
  meter.tokensOut += roundOut;
  meter.cacheCreationTokens += roundCacheCreation;
  meter.cacheReadTokens += roundCacheRead;

  const uncachedIn = roundIn - roundCacheCreation - roundCacheRead;
  const inputCost =
    roundCacheCreation > 0 || roundCacheRead > 0
      ? uncachedIn * model.inputPrice +
        roundCacheCreation * model.inputPrice * 1.25 +
        roundCacheRead * model.inputPrice * (roundCacheReadRate || 0.1)
      : roundIn * model.inputPrice;
  meter.actualCost += inputCost + roundOut * model.outputPrice;

  return content;
}
