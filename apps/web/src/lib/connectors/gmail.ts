type GmailMessage = {
  id: string;
  threadId?: string;
  snippet?: string;
  payload?: {
    mimeType?: string;
    headers?: Array<{ name: string; value: string }>;
    body?: { data?: string };
    parts?: GmailMessage["payload"][];
  };
};

function decodeBase64Url(input: string): string {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Buffer.from(padded, "base64").toString("utf8");
}

function getHeader(headers: Array<{ name: string; value: string }> | undefined, name: string) {
  if (!headers) return null;
  const found = headers.find((h) => h.name.toLowerCase() === name.toLowerCase());
  return found?.value ?? null;
}

function findPart(payload: GmailMessage["payload"], mimeType: string): GmailMessage["payload"] | null {
  if (!payload) return null;
  if (payload.mimeType === mimeType) return payload;
  const parts = payload.parts ?? [];
  for (const part of parts) {
    const match = findPart(part, mimeType);
    if (match) return match;
  }
  return null;
}

function extractBody(payload: GmailMessage["payload"] | undefined): string | null {
  if (!payload) return null;
  const plain = findPart(payload, "text/plain");
  const html = findPart(payload, "text/html");
  const data = plain?.body?.data || html?.body?.data || payload.body?.data;
  if (!data) return null;
  return decodeBase64Url(data);
}

async function gmailFetch(url: string, accessToken: string) {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "unknown error");
    throw new Error(`Gmail API error (${res.status}): ${text}`);
  }
  return res.json();
}

export async function searchEmails(accessToken: string, query: string, maxResults = 5) {
  const listUrl = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
  listUrl.searchParams.set("q", query);
  listUrl.searchParams.set("maxResults", String(Math.max(1, Math.min(maxResults, 20))));

  const list = await gmailFetch(listUrl.toString(), accessToken);
  const messages = (list.messages ?? []) as Array<{ id: string }>;

  const details = await Promise.all(
    messages.map(async ({ id }) => {
      const msgUrl = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}`);
      msgUrl.searchParams.set("format", "metadata");
      msgUrl.searchParams.append("metadataHeaders", "Subject");
      msgUrl.searchParams.append("metadataHeaders", "From");
      msgUrl.searchParams.append("metadataHeaders", "Date");
      const msg = (await gmailFetch(msgUrl.toString(), accessToken)) as GmailMessage;
      const headers = msg.payload?.headers ?? [];
      return {
        id: msg.id,
        threadId: msg.threadId,
        subject: getHeader(headers, "Subject"),
        from: getHeader(headers, "From"),
        date: getHeader(headers, "Date"),
        snippet: msg.snippet ?? null,
      };
    })
  );

  return { query, results: details };
}

export async function readEmail(accessToken: string, emailId: string) {
  const msgUrl = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${emailId}`);
  msgUrl.searchParams.set("format", "full");
  const msg = (await gmailFetch(msgUrl.toString(), accessToken)) as GmailMessage;
  const headers = msg.payload?.headers ?? [];
  const body = extractBody(msg.payload) ?? "";

  return {
    id: msg.id,
    threadId: msg.threadId,
    subject: getHeader(headers, "Subject"),
    from: getHeader(headers, "From"),
    date: getHeader(headers, "Date"),
    snippet: msg.snippet ?? null,
    body: body.slice(0, 8000),
  };
}
