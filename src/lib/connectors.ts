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

export const CONNECTORS: ConnectorDef[] = [
  {
    id: "gmail",
    name: "Gmail",
    connectionType: "oauth",
    description: "read emails & receipts",
    iconPath:
      "M24 5.457v13.909c0 .904-.732 1.636-1.636 1.636h-3.819V11.73L12 16.64l-6.545-4.91v9.273H1.636A1.636 1.636 0 0 1 0 19.366V5.457c0-2.023 2.309-3.178 3.927-1.964L5.455 4.64 12 9.548l6.545-4.91 1.528-1.145C21.69 2.28 24 3.434 24 5.457z",
    tools: [
      {
        type: "function",
        function: {
          name: "search_emails",
          description:
            "Search the user's Gmail inbox. Use when they ask about emails, receipts, or messages.",
          parameters: {
            type: "object",
            properties: {
              query: { type: "string", description: "Search query for Gmail" },
              max_results: {
                type: "number",
                description: "Max results to return (default 5)",
              },
            },
            required: ["query"],
          },
        },
        commandLabel: "Search emails",
        chatPrompt: "Search my emails",
      },
      {
        type: "function",
        function: {
          name: "read_email",
          description: "Read the full content of a specific email by ID.",
          parameters: {
            type: "object",
            properties: {
              email_id: { type: "string", description: "The email message ID" },
            },
            required: ["email_id"],
          },
        },
        commandLabel: "Read email",
        chatPrompt: "Read my latest email",
      },
    ],
  },
  {
    id: "github",
    name: "GitHub",
    connectionType: "oauth",
    description: "repos & issues",
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
    ],
  },
  {
    id: "vercel",
    name: "Vercel",
    connectionType: "oauth",
    description: "deploys & projects",
    iconPath: "M24 22.525H0l12-21.05 12 21.05z",
    tools: [
      {
        type: "function",
        function: {
          name: "vercel_deploy",
          description:
            "Trigger a deployment on Vercel for a project.",
          parameters: {
            type: "object",
            properties: {
              project: {
                type: "string",
                description: "Vercel project name or ID",
              },
            },
            required: ["project"],
          },
        },
        commandLabel: "Deploy",
        chatPrompt: "Deploy my Vercel project",
      },
      {
        type: "function",
        function: {
          name: "vercel_list_deployments",
          description: "List recent deployments for a Vercel project.",
          parameters: {
            type: "object",
            properties: {
              project: {
                type: "string",
                description: "Vercel project name or ID",
              },
            },
            required: ["project"],
          },
        },
        commandLabel: "List deployments",
        chatPrompt: "Show me my recent Vercel deployments",
      },
    ],
  },
  {
    id: "stripe",
    name: "Stripe",
    connectionType: "oauth",
    description: "payments & subscriptions",
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
    description: "bank balances & transactions",
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
    id: "ramp",
    name: "Ramp",
    connectionType: "api_key",
    description: "card expenses & spending",
    iconPath:
      "M16 6l2.29 2.29-4.88 4.88-4-4L2 16.59 3.41 18l6-6 4 4 6.3-6.29L22 12V6z",
    tools: [
      {
        type: "function",
        function: {
          name: "ramp_list_transactions",
          description: "List recent Ramp card transactions and expenses.",
          parameters: {
            type: "object",
            properties: {
              limit: {
                type: "number",
                description: "Max results to return (default 10)",
              },
            },
          },
        },
        commandLabel: "List expenses",
        chatPrompt: "Show me my recent Ramp expenses",
      },
      {
        type: "function",
        function: {
          name: "ramp_get_spending_summary",
          description: "Get spending summary and category breakdown from Ramp.",
          parameters: {
            type: "object",
            properties: {
              period: {
                type: "string",
                description: "Time period: this_month, last_month, this_quarter",
              },
            },
          },
        },
        commandLabel: "Spending summary",
        chatPrompt: "Show me my Ramp spending summary for this month",
      },
    ],
  },
  {
    id: "supabase",
    name: "Supabase",
    connectionType: "api_key",
    description: "database queries",
    iconPath:
      "M11.9 1.036c-.015-.986-1.26-1.41-1.874-.637L.764 12.05C-.33 13.427.65 15.455 2.409 15.455h9.579l.113 7.51c.014.985 1.259 1.408 1.873.636l9.262-11.653c1.093-1.375.113-3.403-1.645-3.403h-9.642z",
    tools: [
      {
        type: "function",
        function: {
          name: "supabase_query",
          description:
            "Run a read-only SQL query against the user's Supabase database.",
          parameters: {
            type: "object",
            properties: {
              query: { type: "string", description: "SQL query to execute" },
            },
            required: ["query"],
          },
        },
        commandLabel: "Run query",
        chatPrompt: "Run a query on my Supabase database",
      },
      {
        type: "function",
        function: {
          name: "supabase_list_tables",
          description: "List all tables in the user's Supabase database.",
          parameters: { type: "object", properties: {} },
        },
        commandLabel: "List tables",
        chatPrompt: "List my Supabase database tables",
      },
    ],
  },
  {
    id: "posthog",
    name: "PostHog",
    connectionType: "api_key",
    description: "product analytics & events",
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
