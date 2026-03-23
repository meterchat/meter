import { NextRequest } from "next/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { authenticateMcpKey } from "@/lib/mcp-auth";
import { getSupabaseServer } from "@/lib/supabase";

/* ─── Helpers ────────────────────────────────────────────────── */

function unauthorized() {
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}

/* ─── MCP Server factory ─────────────────────────────────────── */

function createMcpServer(userId: string) {
  const server = new McpServer(
    { name: "meter", version: "1.0.0" },
    { capabilities: {} },
  );

  const supabase = getSupabaseServer();

  // ── get_decisions ──────────────────────────────────────────
  server.registerTool(
    "get_decisions",
    {
      description: "List and search your decision log",
      inputSchema: {
        session_id: z.string().optional().describe("Filter by workspace/session ID"),
        query: z.string().optional().describe("Search term to filter decisions by title"),
      },
    },
    async ({ session_id, query }) => {
      let q = supabase
        .from("decisions")
        .select("id, title, status, choice, reasoning, category, version, revisit_count, created_at, updated_at")
        .eq("user_id", userId)
        .eq("archived", false)
        .order("created_at", { ascending: false })
        .limit(50);

      if (session_id) {
        q = q.or(`session_id.eq.${session_id},project_id.eq.${session_id}`);
      }
      if (query) {
        q = q.ilike("title", `%${query}%`);
      }

      const { data, error } = await q;
      if (error) return { content: [{ type: "text" as const, text: `Error: ${error.message}` }] };

      return {
        content: [{ type: "text" as const, text: JSON.stringify(data ?? [], null, 2) }],
      };
    },
  );

  // ── get_decision ───────────────────────────────────────────
  server.registerTool(
    "get_decision",
    {
      description: "Fetch full detail of a single decision",
      inputSchema: {
        id: z.string().describe("The decision ID"),
      },
    },
    async ({ id }) => {
      const { data, error } = await supabase
        .from("decisions")
        .select("*")
        .eq("id", id)
        .eq("user_id", userId)
        .single();

      if (error) return { content: [{ type: "text" as const, text: `Error: ${error.message}` }] };
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    },
  );

  // ── get_blueprints ─────────────────────────────────────────
  server.registerTool(
    "get_blueprints",
    {
      description: "List and search your blueprints (artifacts)",
      inputSchema: {
        session_id: z.string().optional().describe("Filter by workspace/session ID"),
      },
    },
    async ({ session_id }) => {
      let q = supabase
        .from("artifacts")
        .select("id, file_path, status, version, category, created_at, last_generated_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(50);

      if (session_id) {
        q = q.or(`session_id.eq.${session_id},project_id.eq.${session_id}`);
      }

      const { data, error } = await q;
      if (error) return { content: [{ type: "text" as const, text: `Error: ${error.message}` }] };
      return { content: [{ type: "text" as const, text: JSON.stringify(data ?? [], null, 2) }] };
    },
  );

  // ── get_blueprint ──────────────────────────────────────────
  server.registerTool(
    "get_blueprint",
    {
      description: "Fetch full content of a single blueprint",
      inputSchema: {
        id: z.string().describe("The blueprint/artifact ID"),
      },
    },
    async ({ id }) => {
      const { data, error } = await supabase
        .from("artifacts")
        .select("*")
        .eq("id", id)
        .eq("user_id", userId)
        .single();

      if (error) return { content: [{ type: "text" as const, text: `Error: ${error.message}` }] };
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    },
  );

  // ── get_debates ────────────────────────────────────────────
  server.registerTool(
    "get_debates",
    {
      description: "Browse debate summaries with synthesis",
      inputSchema: {
        limit: z.number().optional().default(20).describe("Max results to return"),
      },
    },
    async ({ limit }) => {
      const { data, error } = await supabase
        .from("chat_sessions")
        .select("id, title, model, created_at, updated_at")
        .eq("user_id", userId)
        .is("deleted_at", null)
        .order("updated_at", { ascending: false })
        .limit(limit);

      if (error) return { content: [{ type: "text" as const, text: `Error: ${error.message}` }] };
      return { content: [{ type: "text" as const, text: JSON.stringify(data ?? [], null, 2) }] };
    },
  );

  // ── search ─────────────────────────────────────────────────
  server.registerTool(
    "search",
    {
      description: "Full-text search across decisions, blueprints, and debates",
      inputSchema: {
        query: z.string().describe("Search term"),
      },
    },
    async ({ query }) => {
      const pattern = `%${query}%`;

      const [decisions, artifacts, sessions] = await Promise.all([
        supabase
          .from("decisions")
          .select("id, title, status, choice, category")
          .eq("user_id", userId)
          .eq("archived", false)
          .or(`title.ilike.${pattern},choice.ilike.${pattern},reasoning.ilike.${pattern}`)
          .limit(20),
        supabase
          .from("artifacts")
          .select("id, file_path, status, category")
          .eq("user_id", userId)
          .or(`file_path.ilike.${pattern},content.ilike.${pattern}`)
          .limit(20),
        supabase
          .from("chat_sessions")
          .select("id, title")
          .eq("user_id", userId)
          .is("deleted_at", null)
          .ilike("title", pattern)
          .limit(20),
      ]);

      const results = {
        decisions: decisions.data ?? [],
        blueprints: artifacts.data ?? [],
        debates: sessions.data ?? [],
      };

      return { content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }] };
    },
  );

  // ── create_decision ────────────────────────────────────────
  server.registerTool(
    "create_decision",
    {
      description: "Record a new decision from your IDE",
      inputSchema: {
        title: z.string().describe("Decision title"),
        choice: z.string().optional().describe("The chosen option"),
        alternatives: z.string().optional().describe("Alternatives considered (comma-separated)"),
        reasoning: z.string().optional().describe("Why this choice was made"),
        category: z.string().optional().describe("Category (e.g. architecture, tooling, design)"),
        session_id: z.string().optional().describe("Workspace/session ID to scope the decision"),
      },
    },
    async ({ title, choice, alternatives, reasoning, category, session_id }) => {
      const { data, error } = await supabase
        .from("decisions")
        .insert({
          user_id: userId,
          title,
          status: choice ? "decided" : "undecided",
          choice: choice ?? null,
          alternatives: alternatives ?? null,
          reasoning: reasoning ?? null,
          category: category ?? null,
          session_id: session_id ?? null,
          archived: false,
          version: 1,
          revisit_count: 0,
        })
        .select("id, title, status")
        .single();

      if (error) return { content: [{ type: "text" as const, text: `Error: ${error.message}` }] };
      return { content: [{ type: "text" as const, text: `Decision created: ${JSON.stringify(data)}` }] };
    },
  );

  return server;
}

/* ─── Route handlers ─────────────────────────────────────────── */

async function handleMcpRequest(req: NextRequest) {
  const userId = await authenticateMcpKey(req);
  if (!userId) return unauthorized();

  const transport = new WebStandardStreamableHTTPServerTransport();
  const server = createMcpServer(userId);
  await server.connect(transport);

  return transport.handleRequest(req as unknown as Request);
}

export async function POST(req: NextRequest) {
  return handleMcpRequest(req);
}

export async function GET(req: NextRequest) {
  return handleMcpRequest(req);
}

export async function DELETE(req: NextRequest) {
  return handleMcpRequest(req);
}
