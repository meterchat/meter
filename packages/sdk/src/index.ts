export interface MeterConfig {
  /** Your Meter API key (starts with mk_) */
  apiKey: string;
  /** Base URL for the Meter API. Default: https://getmeter.dev */
  baseUrl?: string;
}

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface ChatOptions {
  /** Array of chat messages */
  messages: ChatMessage[];
  /** OpenRouter model ID (e.g. "anthropic/claude-opus-4.6"). Default: "anthropic/claude-opus-4.6" */
  model?: string;
}

export interface DeltaEvent {
  type: "delta";
  content: string;
  tokensOut: number;
}

export interface UsageEvent {
  type: "usage";
  tokensIn: number;
  tokensOut: number;
}

export interface DoneEvent {
  type: "done";
}

export type MeterEvent = DeltaEvent | UsageEvent | DoneEvent;

export class MeterClient {
  private apiKey: string;
  private baseUrl: string;

  constructor(config: MeterConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl ?? "https://getmeter.dev").replace(
      /\/$/,
      ""
    );
  }

  /**
   * Stream an AI chat response.
   * Returns an async iterable of MeterEvent objects.
   */
  async chat(options: ChatOptions): Promise<AsyncIterable<MeterEvent>> {
    const response = await fetch(`${this.baseUrl}/api/v1/chat`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messages: options.messages,
        model: options.model,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new MeterError(response.status, text);
    }

    if (!response.body) {
      throw new MeterError(0, "No response body");
    }

    return parseSSEStream(response.body);
  }
}

export class MeterError extends Error {
  status: number;

  constructor(status: number, body: string) {
    super(`Meter API error ${status}: ${body}`);
    this.name = "MeterError";
    this.status = status;
  }
}

async function* parseSSEStream(
  body: ReadableStream<Uint8Array>
): AsyncGenerator<MeterEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = JSON.parse(line.slice(6)) as MeterEvent;
        yield data;
        if (data.type === "done") return;
      }
    }
  } finally {
    reader.releaseLock();
  }
}
