/* ─── Connector definitions ────────────────────────────────────── */

export interface ConnectorToolDef {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
  /** Human-readable label shown in command bar & slash popover */
  commandLabel: string;
  /** Natural-language prompt auto-sent as a chat message when the command is selected */
  chatPrompt: string;
}

export interface ConnectorDef {
  id: string;
  name: string;
  /** SVG path data for the icon (rendered in a 24×24 viewBox) */
  iconPath: string;
  connectionType: "oauth" | "api_key";
  description: string;
  tools: ConnectorToolDef[];
}

/* ─── Top-level slash commands (/money, /revenue, /users, /code) ── */

export interface SlashCommandDef {
  /** The command name without the leading "/" */
  command: string;
  /** What the builder needs to know */
  label: string;
  /** Natural-language prompt auto-sent as a chat message */
  chatPrompt: string;
  /** Which connector powers this command */
  connectorId: string;
  /** SVG path data for the icon (24×24 viewBox) — uses connector's icon */
  iconPath: string;
}

export const SLASH_COMMANDS: SlashCommandDef[] = [
  {
    command: "debate",
    label: "/debate",
    chatPrompt:
      "Debate this.",
    connectorId: "_builtin",
    iconPath:
      "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z",
  },
  {
    command: "decide",
    label: "/decide",
    chatPrompt:
      "Lock this as a decision. Summarize the choice, reasoning, and category, then save it.",
    connectorId: "_builtin",
    iconPath:
      "M9 11l3 3L22 4 M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11",
  },
  {
    command: "fork",
    label: "/fork",
    chatPrompt:
      "Fork this into separate paths so I can explore each option independently.",
    connectorId: "_builtin",
    iconPath:
      "M6 3v12 M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M18 9a9 9 0 0 1-9 9",
  },
  {
    command: "dissect",
    label: "/dissect",
    chatPrompt:
      "Dissect this.",
    connectorId: "_builtin",
    iconPath:
      "M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z",
  },
  {
    command: "score",
    label: "/score",
    chatPrompt:
      "Score this idea out of 100. Evaluate across the most important criteria — market size, feasibility, timing, defensibility, and any other dimensions that matter for this specific idea. Present the scores in a simple table with each criterion, its score, and one line of reasoning. End with an overall score and a one-sentence verdict.",
    connectorId: "_builtin",
    iconPath:
      "M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z",
  },
  {
    command: "blueprint",
    label: "/blueprint",
    chatPrompt:
      "Blueprint. Generate my full project spec files — README.md, ARCHITECTURE.md, DESIGN.md, DECISIONS.md, CLAUDE.md, and .cursorrules — based on all locked decisions and our conversation. Ask me to clarify anything major before generating.",
    connectorId: "_builtin",
    iconPath:
      "M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z",
  },
  {
    command: "export",
    label: "/export",
    chatPrompt:
      "Export everything. Package my full chat history, debates, decisions, documents, and timeline into a downloadable format.",
    connectorId: "_builtin",
    iconPath:
      "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M7 10l5 5 5-5 M12 15V3",
  },
  {
    command: "publish",
    label: "/publish",
    chatPrompt:
      "Publish a documentation site. Review my saved documents and our conversation history, then help me compile a polished documentation portal.\n\nBefore generating anything, ask me:\n1. What is this documentation for? (product docs, API reference, internal wiki, onboarding guide, etc.)\n2. Which of my saved documents should be included? (list them for me to pick from)\n3. What additional pages or sections should I create from scratch?\n4. Any specific ordering or grouping preferences?\n\nOnce I confirm, generate each page as a saved artifact with clean markdown structure, and then create a special artifact with file_path \"_docs_config.json\" and category \"other\" that defines the site navigation. The _docs_config.json should follow this format:\n{\n  \"title\": \"Site Title\",\n  \"description\": \"One-line description\",\n  \"navigation\": [\n    {\n      \"section\": \"Section Name\",\n      \"pages\": [\n        { \"path\": \"README.md\", \"label\": \"Introduction\" }\n      ]\n    }\n  ]\n}\n\nAfter generating everything, share the portal link so I can preview it.",
    connectorId: "_builtin",
    iconPath:
      "M4 19.5A2.5 2.5 0 0 1 6.5 17H20 M4 19.5A2.5 2.5 0 0 0 6.5 22H20V2H6.5A2.5 2.5 0 0 0 4 4.5v15z",
  },
  {
    command: "circuit",
    label: "/circuit",
    chatPrompt:
      "Run /circuit — surface my active two-way email conversations from the last 30 days. Search my sent messages, read threads to confirm two-way exchange, filter out newsletters and automated messages, classify by relationship type (investor, partner, vendor, customer, etc.), extract deadlines and action items, and present the full circuit table with status (waiting on me / waiting on them / active / stalled). Include upcoming deadlines, my action items, and what I'm waiting on others for.",
    connectorId: "gmail",
    iconPath:
      "M13 10V3L4 14h7v7l9-11h-7z",
  },
];

/* ─── v1 Connectors: GitHub, Stripe, Mercury, PostHog ──────────── */

export const CONNECTORS: ConnectorDef[] = [
  {
    id: "gmail",
    name: "Gmail",
    connectionType: "oauth",
    description: "read emails & receipts",
    iconPath: "M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z",
    tools: [
      {
        type: "function",
        function: {
          name: "search_emails",
          description: "Search Gmail inbox by query string. Returns matching emails with subject, from, date, and snippet.",
          parameters: {
            type: "object",
            properties: {
              query: { type: "string", description: "Gmail search query (e.g. 'from:bob subject:invoice')" },
              max_results: { type: "number", description: "Max emails to return (default 10)" },
            },
            required: ["query"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "read_email",
          description: "Read the full content of a specific email by ID. Returns subject, from, date, and full body text.",
          parameters: {
            type: "object",
            properties: {
              email_id: { type: "string", description: "Gmail message ID (from search_emails results)" },
            },
            required: ["email_id"],
          },
        },
      },
    ],
  },
  {
    id: "github",
    name: "GitHub",
    connectionType: "oauth",
    description: "repos, PRs & commits",
    iconPath:
      "M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12",
    tools: [
      {
        type: "function",
        function: {
          name: "github_create_repo",
          description: "Create a new GitHub repository.",
          parameters: {
            type: "object",
            properties: {
              name: { type: "string", description: "Repository name" },
              description: {
                type: "string",
                description: "Repository description",
              },
              private: {
                type: "boolean",
                description: "Whether the repo is private",
              },
            },
            required: ["name"],
          },
        },
        commandLabel: "Create repo",
        chatPrompt: "Create a new GitHub repository",
      },
      {
        type: "function",
        function: {
          name: "github_list_repos",
          description: "List the user's GitHub repositories.",
          parameters: { type: "object", properties: {} },
        },
        commandLabel: "List repos",
        chatPrompt: "List my GitHub repositories",
      },
      {
        type: "function",
        function: {
          name: "github_create_issue",
          description: "Create an issue on a GitHub repository.",
          parameters: {
            type: "object",
            properties: {
              repo: {
                type: "string",
                description: "Repository in owner/name format",
              },
              title: { type: "string", description: "Issue title" },
              body: { type: "string", description: "Issue body (markdown)" },
            },
            required: ["repo", "title"],
          },
        },
        commandLabel: "Create issue",
        chatPrompt: "Create a GitHub issue",
      },
      {
        type: "function",
        function: {
          name: "github_push_file",
          description:
            "Push a file to a GitHub repository. Creates or updates the file with a commit.",
          parameters: {
            type: "object",
            properties: {
              repo: {
                type: "string",
                description: "Repository in owner/name format",
              },
              path: {
                type: "string",
                description: "File path in the repo (e.g. 'CLAUDE.md', 'docs/ARCHITECTURE.md')",
              },
              content: {
                type: "string",
                description: "Full file content to push",
              },
              message: {
                type: "string",
                description: "Git commit message",
              },
            },
            required: ["repo", "path", "content", "message"],
          },
        },
        commandLabel: "Push file",
        chatPrompt: "Push a file to my GitHub repo",
      },
      {
        type: "function",
        function: {
          name: "github_get_file",
          description: "Read a file's content from a GitHub repository.",
          parameters: {
            type: "object",
            properties: {
              repo: {
                type: "string",
                description: "Repository in owner/name format",
              },
              path: {
                type: "string",
                description: "File path in the repo",
              },
            },
            required: ["repo", "path"],
          },
        },
        commandLabel: "Get file",
        chatPrompt: "Read a file from my GitHub repo",
      },
    ],
  },
  {
    id: "stripe",
    name: "Stripe",
    connectionType: "oauth",
    description: "MRR, customers & churn",
    iconPath:
      "M13.976 9.15c-2.172-.806-3.356-1.426-3.356-2.409 0-.831.683-1.305 1.901-1.305 2.227 0 4.515.858 6.09 1.631l.89-5.494C18.252.975 15.697 0 12.165 0 9.667 0 7.589.654 6.104 1.872 4.56 3.147 3.757 4.992 3.757 7.218c0 4.039 2.467 5.76 6.476 7.219 2.585.92 3.445 1.574 3.445 2.583 0 .98-.84 1.545-2.354 1.545-1.875 0-4.965-.921-6.99-2.109l-.9 5.555C5.175 22.99 8.385 24 11.714 24c2.641 0 4.843-.624 6.328-1.813 1.664-1.305 2.525-3.236 2.525-5.732 0-4.128-2.524-5.851-6.594-7.305h.003z",
    tools: [
      {
        type: "function",
        function: {
          name: "stripe_list_payments",
          description: "List recent payments and charges from Stripe.",
          parameters: {
            type: "object",
            properties: {
              limit: {
                type: "number",
                description: "Max results to return (default 10)",
              },
              status: {
                type: "string",
                description: "Filter by status: succeeded, pending, failed",
              },
            },
          },
        },
        commandLabel: "List payments",
        chatPrompt: "Show me my recent Stripe payments",
      },
      {
        type: "function",
        function: {
          name: "stripe_get_balance",
          description: "Get current Stripe account balance and pending amounts.",
          parameters: { type: "object", properties: {} },
        },
        commandLabel: "Get balance",
        chatPrompt: "What's my Stripe balance?",
      },
      {
        type: "function",
        function: {
          name: "stripe_list_subscriptions",
          description: "List active subscriptions and their billing details.",
          parameters: {
            type: "object",
            properties: {
              status: {
                type: "string",
                description: "Filter by status: active, canceled, past_due, all",
              },
            },
          },
        },
        commandLabel: "List subscriptions",
        chatPrompt: "Show me my active Stripe subscriptions",
      },
    ],
  },
  {
    id: "mercury",
    name: "Mercury",
    connectionType: "api_key",
    description: "runway, balances & burn",
    iconPath:
      "M4 10h3v7H4zm6.5 0h3v7h-3zM2 19h20v3H2zm15-9h3v7h-3zM12 1L2 6v2h20V6z",
    tools: [
      {
        type: "function",
        function: {
          name: "mercury_get_accounts",
          description: "List Mercury bank accounts with balances.",
          parameters: { type: "object", properties: {} },
        },
        commandLabel: "Get accounts",
        chatPrompt: "Show me my Mercury bank accounts",
      },
      {
        type: "function",
        function: {
          name: "mercury_list_transactions",
          description: "List recent transactions from Mercury bank account.",
          parameters: {
            type: "object",
            properties: {
              limit: {
                type: "number",
                description: "Max results to return (default 10)",
              },
              account_id: {
                type: "string",
                description: "Mercury account ID to query",
              },
            },
          },
        },
        commandLabel: "List transactions",
        chatPrompt: "Show me my recent Mercury transactions",
      },
    ],
  },
  {
    id: "posthog",
    name: "PostHog",
    connectionType: "api_key",
    description: "DAUs, retention & funnels",
    iconPath:
      "M3 3v18h18V3H3zm2 16V5h2v14H5zm4 0V5h2v14H9zm4 0V9h2v10h-2zm4 0v-6h2v6h-2z",
    tools: [
      {
        type: "function",
        function: {
          name: "posthog_query_events",
          description: "Query recent events from PostHog. Use to look up user activity, pageviews, or custom events.",
          parameters: {
            type: "object",
            properties: {
              event: { type: "string", description: "Event name to filter by (e.g. '$pageview', 'signup')" },
              limit: { type: "number", description: "Max results to return (default 10)" },
            },
          },
        },
        commandLabel: "Query events",
        chatPrompt: "Show me recent PostHog events",
      },
      {
        type: "function",
        function: {
          name: "posthog_get_insights",
          description: "List saved insights (charts, funnels, trends) from PostHog.",
          parameters: {
            type: "object",
            properties: {
              limit: { type: "number", description: "Max results to return (default 10)" },
            },
          },
        },
        commandLabel: "Get insights",
        chatPrompt: "Show me my PostHog insights",
      },
    ],
  },
];

/** Get a connector definition by id */
export function getConnector(id: string): ConnectorDef | undefined {
  return CONNECTORS.find((c) => c.id === id);
}
