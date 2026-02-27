const MERCURY_API = "https://api.mercury.com/api/v1";

async function mercuryFetch(apiKey: string, path: string) {
  const res = await fetch(`${MERCURY_API}${path}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "unknown error");
    throw new Error(`Mercury API error (${res.status}): ${text}`);
  }
  return res.json();
}

export async function getAccounts(apiKey: string) {
  const data = await mercuryFetch(apiKey, "/accounts");
  const accounts = (data.accounts ?? data) as Array<Record<string, unknown>>;
  return {
    accounts: accounts.map((a) => ({
      id: a.id,
      name: a.name,
      kind: a.kind,
      status: a.status,
      currentBalance: a.currentBalance,
      availableBalance: a.availableBalance,
      currency: a.currency ?? "USD",
    })),
  };
}

export async function listTransactions(
  apiKey: string,
  params: { limit?: number; account_id?: string }
) {
  const limit = Math.max(1, Math.min(params.limit ?? 10, 50));
  const accountId = params.account_id;

  if (!accountId) {
    // Get first account, then its transactions
    const accounts = await getAccounts(apiKey);
    if (accounts.accounts.length === 0) {
      return { transactions: [], message: "No Mercury accounts found." };
    }
    const firstId = accounts.accounts[0].id;
    return listTransactions(apiKey, { limit, account_id: firstId as string });
  }

  const data = await mercuryFetch(
    apiKey,
    `/account/${accountId}/transactions?limit=${limit}`
  );
  const transactions = (data.transactions ?? data) as Array<Record<string, unknown>>;
  return {
    account_id: accountId,
    transactions: transactions.slice(0, limit).map((t) => ({
      id: t.id,
      amount: t.amount,
      status: t.status,
      counterpartyName: t.counterpartyName,
      note: t.note,
      kind: t.kind,
      createdAt: t.createdAt,
    })),
  };
}
