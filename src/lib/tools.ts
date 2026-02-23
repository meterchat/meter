import { getSupabaseServer } from "@/lib/supabase";
import { CONNECTORS, ConnectorToolDef } from "@/lib/connectors";
import { getValidAccessToken } from "@/lib/oauth";
import { searchEmails, readEmail } from "@/lib/connectors/gmail";
import { listRepos, createRepo, createIssue } from "@/lib/connectors/github";
import { listDeployments, triggerDeployment } from "@/lib/connectors/vercel";
import { listPayments, getBalance, listSubscriptions } from "@/lib/connectors/stripe";
import { getAccounts as mercuryGetAccounts, listTransactions as mercuryListTransactions } from "@/lib/connectors/mercury";
import { listTransactions as rampListTransactions, getSpendingSummary as rampGetSpendingSummary } from "@/lib/connectors/ramp";
import { supabaseQuery, supabaseListTables } from "@/lib/connectors/supabase-connector";
import { queryEvents as posthogQueryEvents, getInsights as posthogGetInsights } from "@/lib/connectors/posthog";

/* ─── Tool schemas (OpenAI function-calling format) ─────────────── */

export type ToolDef = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

/** Built-in tools — always available regardless of connectors */
export const BUILTIN_TOOLS: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "web_search",
      description:
        "Search the web for current information. Use when the user asks about current events, recent data, prices, news, documentation, or anything that may have changed recently.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "The search query" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_current_datetime",
      description:
        "Get the current date and time. Use when the user asks about today's date, what day it is, or needs temporal context.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "save_decision",
      description:
        "Save a decision or recommendation so the user can track it. Use when the user makes a choice, reaches a conclusion, or asks for a recommendation they should remember.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Short title for the decision" },
          choice: { type: "string", description: "The chosen option or recommendation" },
          alternatives: {
            type: "array",
            items: { type: "string" },
            description: "Other options that were considered",
          },
          reasoning: { type: "string", description: "Why this choice was made" },
        },
        required: ["title", "choice"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_decisions",
      description:
        "List all saved decisions for the user. Use when they ask about previous decisions or want to review past choices.",
      parameters: { type: "object", properties: {} },
    },
  },
];

/** For backwards compat — all built-in tools */
export const TOOL_DEFINITIONS = BUILTIN_TOOLS;

/**
 * Build the full tool list: built-in tools + tools from connected services.
 */
export function getToolsForConnectors(connectedIds: string[]): ToolDef[] {
  const connectorTools: ToolDef[] = [];
  for (const id of connectedIds) {
    const connector = CONNECTORS.find((c) => c.id === id);
    if (connector) {
      connectorTools.push(...(connector.tools as ToolDef[]));
    }
  }
  return [...BUILTIN_TOOLS, ...connectorTools];
}

/* ─── System prompt ─────────────────────────────────────────────── */

export function buildSystemPrompt(connectedIds: string[]): string {
  const connectorLines = connectedIds
    .map((id) => {
      const c = CONNECTORS.find((conn) => conn.id === id);
      if (!c) return null;
      return c.tools
        .map((t) => `- ${t.function.name}: ${t.function.description}`)
        .join("\n");
    })
    .filter(Boolean)
    .join("\n");

  const connectorSection = connectorLines
    ? `\n\nConnected services:\n${connectorLines}`
    : "";

  return `You are Meter — an AI assistant that can search the web, track decisions, and help users build things.

You have tools. Use them:
- web_search: Search the web for anything current — news, docs, prices, APIs, etc. Use this proactively when questions touch on recent events or data you're unsure about.
- save_decision: Log important decisions when the user makes a choice or asks you to recommend something. This helps them track what was decided and why.
- list_decisions: Recall past decisions when the user asks "what did we decide" or references earlier choices.
- get_current_datetime: Know what day/time it is.${connectorSection}

Be direct and concise. Write in plain prose — avoid bullet lists and bold text unless truly necessary. Use short paragraphs instead of lists. When citing search results, mention the source. Don't apologize for using tools — just use them when they'll help.

When you sense the user has reached a decision point — they've picked an approach, chosen a tool, settled on a name, committed to a direction — end your response with a brief question like "Want me to lock this in, or would you like a second opinion?" followed by the tag [decision-point] on its own line. This tag gives the user buttons to either log the decision or trigger a multi-model debate. Only use this when a meaningful choice or recommendation is being discussed, not on routine messages.

Review items: When you identify actionable items from the conversation, emails, or connected services, tag them with markers so they appear in the user's Review panel:
- Follow-ups from email or chat: wrap in [follow-up]...[/follow-up] tags. Example: [follow-up]Reply to Sarah about the contract by Friday[/follow-up]
- Subscriptions renewing or expiring: wrap in [subscription]...[/subscription] tags. Example: [subscription]Figma Pro renews Mar 1 — $15/mo[/subscription]
- Purchases or payments confirmed in chat: wrap in [purchase]...[/purchase] tags. Example: [purchase]Domain example.com purchased — $12/yr[/purchase]
Use these tags inline in your responses whenever you spot these items. The user sees them collected in their Review panel.`;
}

export const SYSTEM_PROMPT = buildSystemPrompt([]);

/* ─── Tool execution ────────────────────────────────────────────── */

interface ToolContext {
  userId?: string;
  projectId?: string;
  workspaceId?: string;
}

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<string> {
  switch (name) {
    case "web_search":
      return webSearch(args.query as string);
    case "get_current_datetime":
      return getCurrentDatetime();
    case "save_decision":
      return saveDecision(args, ctx);
    case "list_decisions":
      return listDecisions(ctx);
    // Connector tools
    case "search_emails":
      return withConnectorToken("gmail", ctx, async (token) =>
        searchEmails(token, args.query as string, args.max_results as number | undefined)
      );
    case "read_email":
      return withConnectorToken("gmail", ctx, async (token) =>
        readEmail(token, args.email_id as string)
      );
    case "github_list_repos":
      return withConnectorToken("github", ctx, async (token) =>
        listRepos(token, args.limit as number | undefined)
      );
    case "github_create_repo":
      return withConnectorToken("github", ctx, async (token) =>
        createRepo(token, {
          name: args.name as string,
          description: args.description as string | undefined,
          private: args.private as boolean | undefined,
        })
      );
    case "github_create_issue":
      return withConnectorToken("github", ctx, async (token) =>
        createIssue(token, {
          repo: args.repo as string,
          title: args.title as string,
          body: args.body as string | undefined,
        })
      );
    case "vercel_list_deployments":
      return withConnectorToken("vercel", ctx, async (token) =>
        listDeployments(token, args.project as string, args.limit as number | undefined)
      );
    case "vercel_deploy":
      return withConnectorToken("vercel", ctx, async (token) =>
        triggerDeployment(token, args.project as string)
      );
    case "stripe_list_payments":
      return withConnectorToken("stripe", ctx, async (token) =>
        listPayments(token, {
          limit: args.limit as number | undefined,
          status: args.status as string | undefined,
        })
      );
    case "stripe_get_balance":
      return withConnectorToken("stripe", ctx, async (token) =>
        getBalance(token)
      );
    case "stripe_list_subscriptions":
      return withConnectorToken("stripe", ctx, async (token) =>
        listSubscriptions(token, { status: args.status as string | undefined })
      );
    // Mercury
    case "mercury_get_accounts":
      return withConnectorToken("mercury", ctx, async (token) =>
        mercuryGetAccounts(token)
      );
    case "mercury_list_transactions":
      return withConnectorToken("mercury", ctx, async (token) =>
        mercuryListTransactions(token, {
          limit: args.limit as number | undefined,
          account_id: args.account_id as string | undefined,
        })
      );
    // Ramp
    case "ramp_list_transactions":
      return withConnectorToken("ramp", ctx, async (token) =>
        rampListTransactions(token, { limit: args.limit as number | undefined })
      );
    case "ramp_get_spending_summary":
      return withConnectorToken("ramp", ctx, async (token) =>
        rampGetSpendingSummary(token, { period: args.period as string | undefined })
      );
    // Supabase
    case "supabase_query":
      return withConnectorToken("supabase", ctx, async (token, metadata) =>
        supabaseQuery(token, args.query as string, metadata)
      );
    case "supabase_list_tables":
      return withConnectorToken("supabase", ctx, async (token, metadata) =>
        supabaseListTables(token, metadata)
      );
    // PostHog
    case "posthog_query_events":
      return withConnectorToken("posthog", ctx, async (token) =>
        posthogQueryEvents(token, {
          event: args.event as string | undefined,
          limit: args.limit as number | undefined,
        })
      );
    case "posthog_get_insights":
      return withConnectorToken("posthog", ctx, async (token) =>
        posthogGetInsights(token, { limit: args.limit as number | undefined })
      );
    default:
      return `Unknown tool: ${name}`;
  }
}

async function withConnectorToken(
  providerId: string,
  ctx: ToolContext,
  handler: (accessToken: string, metadata?: Record<string, unknown> | null) => Promise<unknown>
): Promise<string> {
  const wsId = ctx.workspaceId ?? ctx.projectId;
  if (!ctx.userId || !wsId) {
    return "Missing user session. Please sign in and connect the service.";
  }
  try {
    const token = await getValidAccessToken(ctx.userId, providerId, wsId);
    if (!token) {
      return `No ${providerId} connection found. Connect it in Settings.`;
    }
    const result = await handler(token.accessToken, token.metadata ?? null);
    return typeof result === "string" ? result : JSON.stringify(result, null, 2);
  } catch (err) {
    return `Failed to call ${providerId} connector: ${err instanceof Error ? err.message : String(err)}`;
  }
}

/* ── web_search ────────────────────────────────────────────────── */

async function webSearch(query: string): Promise<string> {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY;
  if (!apiKey) {
    return "Web search is not configured (BRAVE_SEARCH_API_KEY missing). Answer from your training data instead.";
  }

  try {
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5`;
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "gzip",
        "X-Subscription-Token": apiKey,
      },
    });

    if (!res.ok) return `Search failed (${res.status}). Answer from your training data instead.`;

    const data = await res.json();
    const results = (data.web?.results ?? []) as {
      title: string;
      url: string;
      description: string;
    }[];

    if (results.length === 0) return "No results found.";

    return results
      .map((r) => `**${r.title}**\n${r.url}\n${r.description}`)
      .join("\n\n");
  } catch (err) {
    return `Search error: ${(err as Error).message}. Answer from your training data instead.`;
  }
}

/* ── get_current_datetime ──────────────────────────────────────── */

function getCurrentDatetime(): string {
  const now = new Date();
  return [
    `Date: ${now.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}`,
    `Time: ${now.toLocaleTimeString("en-US")} UTC`,
    `ISO: ${now.toISOString()}`,
  ].join("\n");
}

/* ── save_decision ─────────────────────────────────────────────── */

async function saveDecision(
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<string> {
  if (!ctx.userId) return "Cannot save decision: not authenticated.";
  try {
    const supabase = getSupabaseServer();
    const id = `dec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    await supabase.from("decisions").insert({
      id,
      user_id: ctx.userId,
      title: args.title as string,
      status: "decided",
      choice: args.choice as string,
      alternatives: args.alternatives || [],
      reasoning: (args.reasoning as string) || null,
      project_id: ctx.projectId || null,
    });

    return JSON.stringify({ id, message: `Decision saved: "${args.title}" — ${args.choice}` });
  } catch (err) {
    return `Failed to save decision: ${(err as Error).message}`;
  }
}

/* ── list_decisions ────────────────────────────────────────────── */

async function listDecisions(ctx: ToolContext): Promise<string> {
  if (!ctx.userId) return "Cannot list decisions: not authenticated.";
  try {
    const supabase = getSupabaseServer();
    const { data } = await supabase
      .from("decisions")
      .select("*")
      .eq("user_id", ctx.userId)
      .eq("archived", false)
      .order("created_at", { ascending: false })
      .limit(20);

    if (!data || data.length === 0) return "No decisions saved yet.";

    return data
      .map(
        (d: { title: string; choice?: string; reasoning?: string }) =>
          `- ${d.title}: ${d.choice || "undecided"}${d.reasoning ? ` (${d.reasoning})` : ""}`
      )
      .join("\n");
  } catch (err) {
    return `Failed to list decisions: ${(err as Error).message}`;
  }
}
