const SUPABASE_REST_VERSION = "1";

async function supabaseFetch(
  projectUrl: string,
  apiKey: string,
  path: string,
  method = "GET",
  body?: string
) {
  const base = projectUrl.replace(/\/+$/, "");
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      apikey: apiKey,
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "X-Client-Info": "meter-connector",
    },
    body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "unknown error");
    throw new Error(`Supabase API error (${res.status}): ${text}`);
  }
  return res.json();
}

export async function supabaseQuery(
  apiKey: string,
  query: string,
  metadata?: Record<string, unknown> | null
) {
  const projectUrl = (metadata?.projectUrl as string) ?? "";
  if (!projectUrl) {
    throw new Error("No Supabase project URL configured. Reconnect Supabase with your project URL.");
  }

  // Use the Supabase REST RPC endpoint for raw SQL (read-only)
  // The pg_meta endpoint allows SQL queries
  const base = projectUrl.replace(/\/+$/, "");
  const res = await fetch(`${base}/rest/v1/rpc/`, {
    method: "POST",
    headers: {
      apikey: apiKey,
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
  });

  // If RPC doesn't work, fall back to the pg-meta SQL endpoint
  if (!res.ok) {
    // Try the SQL query endpoint via pg-meta
    const sqlRes = await fetch(`${base}/pg/query`, {
      method: "POST",
      headers: {
        apikey: apiKey,
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "X-Client-Info": "meter-connector",
      },
      body: JSON.stringify({ query }),
    });

    if (!sqlRes.ok) {
      const text = await sqlRes.text().catch(() => "unknown error");
      throw new Error(`Supabase query failed (${sqlRes.status}): ${text}`);
    }

    return sqlRes.json();
  }

  return res.json();
}

export async function supabaseListTables(
  apiKey: string,
  metadata?: Record<string, unknown> | null
) {
  const projectUrl = (metadata?.projectUrl as string) ?? "";
  if (!projectUrl) {
    throw new Error("No Supabase project URL configured. Reconnect Supabase with your project URL.");
  }

  const base = projectUrl.replace(/\/+$/, "");

  // Use the REST API to query information_schema
  // First try the OpenAPI spec endpoint which lists all tables
  const res = await fetch(`${base}/rest/v1/`, {
    method: "GET",
    headers: {
      apikey: apiKey,
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
  });

  if (res.ok) {
    const spec = await res.json();
    // The OpenAPI spec has paths like "/table_name"
    if (spec.paths) {
      const tables = Object.keys(spec.paths)
        .map((p) => p.replace(/^\//, ""))
        .filter((t) => t && !t.startsWith("rpc/"));
      return { tables };
    }
    // If it's a definitions object
    if (spec.definitions) {
      return { tables: Object.keys(spec.definitions) };
    }
  }

  // Fallback: just return what we got
  const text = await res.text().catch(() => "");
  throw new Error(`Could not list tables (${res.status}): ${text}`);
}
