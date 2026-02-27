const POSTHOG_API = "https://us.posthog.com";

async function posthogFetch(apiKey: string, path: string) {
  // PostHog personal API keys work with Bearer auth
  // Try US cloud first, the most common host
  const res = await fetch(`${POSTHOG_API}${path}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });
  if (!res.ok) {
    // Try EU cloud
    const euRes = await fetch(`https://eu.posthog.com${path}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });
    if (!euRes.ok) {
      const text = await euRes.text().catch(() => "unknown error");
      throw new Error(`PostHog API error (${euRes.status}): ${text}`);
    }
    return euRes.json();
  }
  return res.json();
}

export async function queryEvents(
  apiKey: string,
  params: { event?: string; limit?: number }
) {
  const limit = Math.max(1, Math.min(params.limit ?? 10, 100));

  // Use the events endpoint
  const url = new URL(`${POSTHOG_API}/api/projects/@current/events/`);
  if (params.event) url.searchParams.set("event", params.event);
  url.searchParams.set("limit", String(limit));

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  if (!res.ok) {
    // Try EU
    const euUrl = new URL(`https://eu.posthog.com/api/projects/@current/events/`);
    if (params.event) euUrl.searchParams.set("event", params.event);
    euUrl.searchParams.set("limit", String(limit));

    const euRes = await fetch(euUrl.toString(), {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    if (!euRes.ok) {
      const text = await euRes.text().catch(() => "unknown error");
      throw new Error(`PostHog events query failed (${euRes.status}): ${text}`);
    }
    return formatEvents(await euRes.json());
  }

  return formatEvents(await res.json());
}

function formatEvents(data: { results?: Array<Record<string, unknown>> }) {
  const results = data.results ?? [];
  return {
    count: results.length,
    events: results.map((e) => ({
      event: e.event,
      distinct_id: e.distinct_id,
      timestamp: e.timestamp,
      properties: e.properties,
    })),
  };
}

export async function getInsights(
  apiKey: string,
  params: { limit?: number }
) {
  const limit = Math.max(1, Math.min(params.limit ?? 10, 50));

  const url = new URL(`${POSTHOG_API}/api/projects/@current/insights/`);
  url.searchParams.set("limit", String(limit));

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  if (!res.ok) {
    // Try EU
    const euUrl = new URL(`https://eu.posthog.com/api/projects/@current/insights/`);
    euUrl.searchParams.set("limit", String(limit));

    const euRes = await fetch(euUrl.toString(), {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    if (!euRes.ok) {
      const text = await euRes.text().catch(() => "unknown error");
      throw new Error(`PostHog insights query failed (${euRes.status}): ${text}`);
    }
    return formatInsights(await euRes.json());
  }

  return formatInsights(await res.json());
}

function formatInsights(data: { results?: Array<Record<string, unknown>> }) {
  const results = data.results ?? [];
  return {
    count: results.length,
    insights: results.map((i) => ({
      id: i.id,
      name: i.name,
      description: i.description,
      filters: i.filters,
      last_modified_at: i.last_modified_at,
      created_at: i.created_at,
    })),
  };
}
