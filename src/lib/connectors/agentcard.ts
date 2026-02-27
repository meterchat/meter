/**
 * AgentCard connector — payment identity for AI agents.
 *
 * Communicates with the AgentCard MCP server over HTTP transport
 * (JSON-RPC 2.0 at https://mcp.agentcard.sh/mcp).
 *
 * Users connect by pasting their JWT from ~/.agent-cards/config.json.
 */

const AGENTCARD_MCP_URL =
  process.env.AGENTCARD_MCP_URL ?? "https://mcp.agentcard.sh/mcp";

/* ─── MCP HTTP transport helper ──────────────────────────────── */

let rpcId = 1;

interface McpResponse<T = unknown> {
  jsonrpc: "2.0";
  id: number;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
}

async function mcpCall<T = unknown>(
  jwt: string,
  method: string,
  params: Record<string, unknown> = {}
): Promise<T> {
  const id = rpcId++;
  const res = await fetch(AGENTCARD_MCP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "unknown error");
    throw new Error(`AgentCard MCP error (${res.status}): ${text}`);
  }

  const json = (await res.json()) as McpResponse<T>;
  if (json.error) {
    throw new Error(
      `AgentCard MCP RPC error ${json.error.code}: ${json.error.message}`
    );
  }
  return json.result as T;
}

/* ─── Tool implementations ───────────────────────────────────── */

/**
 * Get the agent's virtual card details (masked PAN, limits, status).
 */
export async function getCard(jwt: string) {
  return mcpCall(jwt, "tools/call", {
    name: "get_card",
    arguments: {},
  });
}

/**
 * Check available spending balance and current limits.
 */
export async function checkBalance(jwt: string) {
  return mcpCall(jwt, "tools/call", {
    name: "check_balance",
    arguments: {},
  });
}

/**
 * List recent agent-initiated transactions.
 */
export async function listTransactions(
  jwt: string,
  params: { limit?: number } = {}
) {
  return mcpCall(jwt, "tools/call", {
    name: "list_transactions",
    arguments: { limit: params.limit ?? 10 },
  });
}

/**
 * Authorize a payment to a merchant/service.
 */
export async function createPayment(
  jwt: string,
  params: { amount: number; currency: string; merchant: string; description?: string }
) {
  return mcpCall(jwt, "tools/call", {
    name: "create_payment",
    arguments: {
      amount: params.amount,
      currency: params.currency,
      merchant: params.merchant,
      ...(params.description ? { description: params.description } : {}),
    },
  });
}
