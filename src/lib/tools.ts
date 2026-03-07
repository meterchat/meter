import { getSupabaseServer } from "@/lib/supabase";
import { CONNECTORS, ConnectorToolDef } from "@/lib/connectors";
import { getValidAccessToken } from "@/lib/oauth";
import { searchEmails, readEmail } from "@/lib/connectors/gmail";
import { listRepos, createRepo, createIssue, getFileContent, createOrUpdateFile } from "@/lib/connectors/github";
import { listDeployments, triggerDeployment } from "@/lib/connectors/vercel";
import { listPayments, getBalance, listSubscriptions } from "@/lib/connectors/stripe";
import { getAccounts as mercuryGetAccounts, listTransactions as mercuryListTransactions } from "@/lib/connectors/mercury";
import { listTransactions as rampListTransactions, getSpendingSummary as rampGetSpendingSummary } from "@/lib/connectors/ramp";
import { supabaseQuery, supabaseListTables } from "@/lib/connectors/supabase-connector";
import { queryEvents as posthogQueryEvents, getInsights as posthogGetInsights } from "@/lib/connectors/posthog";
import { checkDomain as porkbunCheckDomain, getPricing as porkbunGetPricing } from "@/lib/connectors/porkbun";

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
        "Save a decision or recommendation. ALWAYS call list_decisions first to check for existing decisions on the same topic — if one exists, pass its ID in `supersedes` to create a versioned history.",
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
          category: {
            type: "string",
            enum: ["branding", "architecture", "billing", "product", "engineering", "strategy", "other"],
            description: "Category for this decision",
          },
          supersedes: {
            type: "string",
            description: "ID of the existing decision this replaces. Pass this when updating a previous decision to create versioned history.",
          },
        },
        required: ["title", "choice", "category"],
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
  {
    type: "function",
    function: {
      name: "fork_paths",
      description:
        "Fork the conversation into named paths for the user to explore separately. Use ONLY when the user says 'Fork this into paths' — call this tool with short descriptive names for each path based on the options being weighed. Default to 2 paths. Only use 3 rarely when all three are genuinely distinct. Max 4.",
      parameters: {
        type: "object",
        properties: {
          paths: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string", description: "Short name for this path (2-4 words)" },
              },
              required: ["name"],
            },
            description: "The paths to explore (default 2, rarely 3, max 4)",
            minItems: 2,
            maxItems: 4,
          },
        },
        required: ["paths"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "save_artifact",
      description:
        "Save a document for the project. Use for any document the user asks you to create — strategy specs, technical docs, proposals, guides, plans, briefs, notes, or any other structured document. The document will appear as a preview in chat and be saved to the user's Documents folder.",
      parameters: {
        type: "object",
        properties: {
          file_path: {
            type: "string",
            description: "File name with extension (e.g. 'ARCHITECTURE.md', 'product-brief.md', 'api-spec.md', 'meeting-notes.md')",
          },
          content: {
            type: "string",
            description: "Full markdown content of the document",
          },
          category: {
            type: "string",
            enum: ["strategy", "technical", "business", "design", "notes", "other"],
            description: "Category for auto-classification in the documents folder",
          },
        },
        required: ["file_path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "porkbun_check_domain",
      description:
        "Check if a domain name is available for registration and get its price. Use when the user is discussing brand names, project names, or asks about domain availability. A purchase card will appear automatically for available domains.",
      parameters: {
        type: "object",
        properties: {
          domain: {
            type: "string",
            description: "Domain name to check (e.g. 'coolstartup.com', 'mybrand.io')",
          },
        },
        required: ["domain"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "porkbun_get_pricing",
      description:
        "Get registration pricing for popular TLD extensions (.com, .io, .dev, .ai, etc.). Use when the user wants to compare prices across different TLDs.",
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

You can see images and read PDFs. When the user uploads an image or PDF, you receive it directly — describe what you see, answer questions about it, or extract information from it. Never say you cannot see or read attached files.

You have tools. Use them:
- web_search: Search the web for anything current — news, docs, prices, APIs, etc. Use this proactively when questions touch on recent events or data you're unsure about.
- save_decision: Log important decisions when the user makes a choice or asks you to recommend something. IMPORTANT: Before saving, ALWAYS call list_decisions first to check for existing decisions on the same topic. If you find one that this new decision updates or replaces, pass its ID in the \`supersedes\` field — this creates versioned history instead of duplicates. Always assign a category (branding, architecture, billing, product, engineering, strategy, or other).
- list_decisions: Recall past decisions when the user asks "what did we decide" or references earlier choices. Also call this BEFORE save_decision to check for existing decisions on the same topic.
- save_artifact: Save any document — strategy specs, technical docs, proposals, guides, meeting notes, plans, or briefs. Use whenever the user asks you to write, draft, or generate a document. Each document gets a preview in chat and is saved to their Documents folder.
- get_current_datetime: Know what day/time it is.
- porkbun_check_domain: Check if a domain is available and get its price. Use when the user picks a brand name or asks about domains. A purchase card will appear in chat for available domains.
- porkbun_get_pricing: Get pricing for popular TLDs (.com, .io, .dev, etc.).${connectorSection}

Be direct and concise. Write in plain prose — avoid bullet lists and bold text unless truly necessary. Use short paragraphs instead of lists. When citing search results, mention the source. Don't apologize for using tools — just use them when they'll help.

When you sense the user has reached a decision point — a choice between two or more options, an A-vs-B trade-off, picking an approach — end your response with a brief question like "Want me to lock this in, or would you like a second opinion?" followed by the tag [decision-point] on its own line. This gives the user Decide and Debate buttons.

When the user is questioning or stress-testing a singular idea — "is this good enough?", "what are the risks?", "should I go deeper?" — and it's not a fork between options, end your response with the tag [dissect-point] on its own line. This gives the user a Dissect button for deep multi-pass analysis.

When the user is genuinely torn between two or more paths and wants to explore each one in depth before committing — not just picking between options, but needing to think through the consequences of each path separately — end your response with the tag [fork-paths] on its own line. This gives the user an "Explore paths" button that forks the conversation into parallel tracks. Use this sparingly — only when the user is at a real crossroads where exploring each path separately would provide more clarity than a simple debate or decision. Do NOT use [fork-paths] alongside [decision-point] — if the user can just decide, use [decision-point]. [fork-paths] is for when they need to live with each option for a while before choosing. Default to suggesting 2 paths. Only suggest 3 when all three are genuinely distinct options. Maximum 4 paths.

Only use these tags when a meaningful choice or analysis is being discussed, not on routine messages. Use [decision-point] for dual-nature decisions, [dissect-point] for singular ideas under scrutiny, [fork-paths] for deep crossroads requiring parallel exploration.

When the user asks to generate strategy artifacts or prepare specs for their coding agents, create these files using save_artifact:
1. README.md — project overview, purpose, current phase, and how to run it
2. ARCHITECTURE.md — synthesize all decisions into a technical architecture document (tech stack, schema, core flows)
3. DESIGN.md — high-level design philosophy and product/protocol design decisions
4. DECISIONS.md — format each locked decision as an ADR (title, context, decision, consequences)
5. CLAUDE.md — agent instructions optimized for Claude Code / Codex (concise directives, file structure, key patterns)
6. BRAND.md — brand voice, tone, visual identity guidelines, and naming conventions
7. .cursorrules — agent instructions optimized for Cursor
Base all content on the locked decisions and conversation context. Be specific and actionable — these files are read by coding agents, not just humans.

You can also create any other document the user asks for — proposals, briefs, plans, meeting notes, guides, specs. Always use save_artifact so the document appears as a preview in chat and is saved to their Documents folder. Choose an appropriate category: strategy, technical, business, design, notes, or other.

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
  sessionId?: string;
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
    case "save_artifact":
      return saveArtifact(args, ctx);
    case "fork_paths":
      // Client-side tool — server just acknowledges, client creates the subtracks
      return JSON.stringify({ ok: true, paths: args.paths });
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
    case "github_push_file":
      return withConnectorToken("github", ctx, async (token) => {
        const [owner, name] = (args.repo as string).split("/");
        if (!owner || !name) throw new Error("Repo must be in owner/name format.");
        const existing = await getFileContent(token, owner, name, args.path as string);
        return createOrUpdateFile(
          token, owner, name,
          args.path as string,
          args.content as string,
          args.message as string,
          undefined,
          existing?.sha,
        );
      });
    case "github_get_file":
      return withConnectorToken("github", ctx, async (token) => {
        const [owner, name] = (args.repo as string).split("/");
        if (!owner || !name) throw new Error("Repo must be in owner/name format.");
        const result = await getFileContent(token, owner, name, args.path as string);
        if (!result) return "File not found.";
        return result.content;
      });
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
    // Porkbun (platform-level — no user token needed)
    case "porkbun_check_domain":
      return porkbunCheck(args.domain as string);
    case "porkbun_get_pricing":
      return porkbunPricing();
    default:
      return `Unknown tool: ${name}`;
  }
}

async function withConnectorToken(
  providerId: string,
  ctx: ToolContext,
  handler: (accessToken: string, metadata?: Record<string, unknown> | null) => Promise<unknown>
): Promise<string> {
  const wsId = ctx.workspaceId ?? ctx.sessionId;
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
    const supersedesId = args.supersedes as string | undefined;

    let version = 1;
    let parentDecisionId: string | null = null;
    let category = (args.category as string) || "other";

    // If this supersedes an existing decision, archive the old one and link them
    if (supersedesId) {
      const { data: oldDecision } = await supabase
        .from("decisions")
        .select("id, version, category")
        .eq("id", supersedesId)
        .eq("user_id", ctx.userId)
        .single();

      if (oldDecision) {
        // Archive the old decision
        await supabase
          .from("decisions")
          .update({ archived: true, updated_at: new Date().toISOString() })
          .eq("id", supersedesId);

        version = (oldDecision.version ?? 1) + 1;
        parentDecisionId = supersedesId;
        // Inherit category from old decision if not explicitly provided
        if (!args.category && oldDecision.category) {
          category = oldDecision.category;
        }
      }
    }

    await supabase.from("decisions").insert({
      id,
      user_id: ctx.userId,
      title: args.title as string,
      status: "decided",
      choice: args.choice as string,
      alternatives: args.alternatives || [],
      reasoning: (args.reasoning as string) || null,
      session_id: ctx.sessionId ?? null,
      category,
      parent_decision_id: parentDecisionId,
      version,
    });

    const versionLabel = version > 1 ? ` (v${version})` : "";
    return JSON.stringify({ id, message: `Decision saved: "${args.title}"${versionLabel} — ${args.choice}` });
  } catch (err) {
    return `Failed to save decision: ${(err as Error).message}`;
  }
}

/* ── save_artifact ─────────────────────────────────────────────── */

function inferCategory(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (/readme|architecture|decisions|claude|cursorrules/.test(lower)) return "strategy";
  if (/api|schema|spec|config|setup/.test(lower)) return "technical";
  if (/design|brand|style|ui|ux/.test(lower)) return "design";
  if (/budget|revenue|runway|pitch|investor|business/.test(lower)) return "business";
  if (/notes|meeting|standup|retro|log/.test(lower)) return "notes";
  return "other";
}

async function saveArtifact(
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<string> {
  if (!ctx.userId) return "Cannot save artifact: not authenticated.";
  try {
    const supabase = getSupabaseServer();
    const filePath = args.file_path as string;
    const content = args.content as string;
    const sessionId = ctx.sessionId ?? null;

    // Upsert by user_id + session_id + file_path
    let existingId: string | undefined;
    if (sessionId) {
      const { data } = await supabase
        .from("artifacts")
        .select("id")
        .eq("user_id", ctx.userId)
        .or(`session_id.eq.${sessionId},project_id.eq.${sessionId}`)
        .eq("file_path", filePath)
        .maybeSingle();
      existingId = data?.id;
    } else {
      const { data } = await supabase
        .from("artifacts")
        .select("id")
        .eq("user_id", ctx.userId)
        .is("session_id", null)
        .is("project_id", null)
        .eq("file_path", filePath)
        .maybeSingle();
      existingId = data?.id;
    }

    const category = (args.category as string) || inferCategory(filePath);

    if (existingId) {
      await supabase.from("artifacts").update({
        content,
        status: "draft",
        category,
        last_generated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", existingId);
      return JSON.stringify({ id: existingId, filePath, content, category, message: `Updated document: ${filePath}` });
    } else {
      const id = `art_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      await supabase.from("artifacts").insert({
        id,
        user_id: ctx.userId,
        session_id: sessionId,
        file_path: filePath,
        content,
        status: "draft",
        category,
        last_generated_at: new Date().toISOString(),
      });
      return JSON.stringify({ id, filePath, content, category, message: `Created document: ${filePath}` });
    }
  } catch (err) {
    return `Failed to save artifact: ${(err as Error).message}`;
  }
}

/* ── porkbun_check_domain ──────────────────────────────────────── */

async function porkbunCheck(domain: string): Promise<string> {
  try {
    const result = await porkbunCheckDomain(domain);
    return JSON.stringify(result);
  } catch (err) {
    return `Domain check failed: ${(err as Error).message}`;
  }
}

/* ── porkbun_get_pricing ──────────────────────────────────────── */

async function porkbunPricing(): Promise<string> {
  try {
    const all = await porkbunGetPricing();
    const popular = ["com", "net", "org", "io", "dev", "co", "app", "ai", "xyz", "sh", "me", "so", "gg"];
    const filtered: Record<string, unknown> = {};
    for (const tld of popular) {
      if (all[tld]) filtered[tld] = all[tld];
    }
    return JSON.stringify(filtered, null, 2);
  } catch (err) {
    return `Pricing lookup failed: ${(err as Error).message}`;
  }
}

/* ── list_decisions ────────────────────────────────────────────── */

async function listDecisions(ctx: ToolContext): Promise<string> {
  if (!ctx.userId) return "Cannot list decisions: not authenticated.";
  try {
    const supabase = getSupabaseServer();
    let query = supabase
      .from("decisions")
      .select("*")
      .eq("user_id", ctx.userId)
      .eq("archived", false)
      .order("created_at", { ascending: false })
      .limit(20);

    // Scope to active workspace session
    const wsId = ctx.workspaceId ?? ctx.sessionId;
    if (wsId) {
      query = query.or(`session_id.eq.${wsId},project_id.eq.${wsId}`);
    }

    const { data } = await query;

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
