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
  /** End-user ID from your auth system. Required for embedded SDK usage. */
  endUserId?: string;
  /** Session ID to continue a conversation. */
  sessionId?: string;
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

export interface ErrorEvent {
  type: "error";
  message: string;
}

export type MeterEvent = DeltaEvent | UsageEvent | DoneEvent | ErrorEvent;

export interface Session {
  id: string;
  name: string;
  totalCost: number;
  createdAt: string;
  updatedAt: string;
}

export interface HistoryMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  model: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  cost: number | null;
  timestamp: number;
}

export interface BillingStatus {
  cardOnFile: boolean;
  cardLast4: string | null;
  cardBrand: string | null;
  markupMultiplier: number;
}

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

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
    };
  }

  /**
   * Stream an AI chat response.
   * Returns an async iterable of MeterEvent objects.
   */
  async chat(options: ChatOptions): Promise<AsyncIterable<MeterEvent>> {
    const response = await fetch(`${this.baseUrl}/api/v1/chat`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        messages: options.messages,
        model: options.model,
        endUserId: options.endUserId,
        sessionId: options.sessionId,
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

  /** List chat sessions for an end-user. */
  async listSessions(endUserId: string): Promise<Session[]> {
    const res = await fetch(
      `${this.baseUrl}/api/v1/sessions?endUserId=${encodeURIComponent(endUserId)}`,
      { headers: this.headers() }
    );
    if (!res.ok) throw new MeterError(res.status, await res.text());
    const { sessions } = await res.json();
    return (sessions ?? []).map((s: Record<string, unknown>) => ({
      id: s.id,
      name: s.workspace_name ?? s.project_name,
      totalCost: Number(s.total_cost ?? 0),
      createdAt: s.created_at,
      updatedAt: s.updated_at,
    }));
  }

  /** Create a new chat session for an end-user. */
  async createSession(
    endUserId: string,
    name?: string
  ): Promise<{ sessionId: string; name: string }> {
    const res = await fetch(`${this.baseUrl}/api/v1/sessions`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ endUserId, name }),
    });
    if (!res.ok) throw new MeterError(res.status, await res.text());
    return res.json();
  }

  /** Get message history for a session. */
  async getHistory(
    endUserId: string,
    sessionId: string
  ): Promise<HistoryMessage[]> {
    const params = new URLSearchParams({ endUserId, sessionId });
    const res = await fetch(
      `${this.baseUrl}/api/v1/history?${params}`,
      { headers: this.headers() }
    );
    if (!res.ok) throw new MeterError(res.status, await res.text());
    const { messages } = await res.json();
    return (messages ?? []).map((m: Record<string, unknown>) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      model: m.model ?? null,
      tokensIn: m.tokens_in != null ? Number(m.tokens_in) : null,
      tokensOut: m.tokens_out != null ? Number(m.tokens_out) : null,
      cost: m.cost != null ? Number(m.cost) : null,
      timestamp: Number(m.timestamp),
    }));
  }

  /** Check billing status for an end-user. */
  async getBillingStatus(endUserId: string): Promise<BillingStatus> {
    const res = await fetch(
      `${this.baseUrl}/api/v1/billing/status?endUserId=${encodeURIComponent(endUserId)}`,
      { headers: this.headers() }
    );
    if (!res.ok) throw new MeterError(res.status, await res.text());
    return res.json();
  }

  /** Create a Stripe SetupIntent for end-user card on file. */
  async createSetupIntent(
    endUserId: string
  ): Promise<{ clientSecret: string; customerId: string }> {
    const res = await fetch(`${this.baseUrl}/api/v1/billing/setup`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ endUserId }),
    });
    if (!res.ok) throw new MeterError(res.status, await res.text());
    return res.json();
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
