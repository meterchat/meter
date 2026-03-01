const RAMP_API = "https://demo-api.ramp.com/developer/v1";

async function rampFetch(apiKey: string, path: string) {
  const res = await fetch(`${RAMP_API}${path}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    // Try production API
    const prodRes = await fetch(`https://api.ramp.com/developer/v1${path}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    });
    if (!prodRes.ok) {
      const text = await prodRes.text().catch(() => "unknown error");
      throw new Error(`Ramp API error (${prodRes.status}): ${text}`);
    }
    return prodRes.json();
  }
  return res.json();
}

export async function listTransactions(
  apiKey: string,
  params: { limit?: number }
) {
  const limit = Math.max(1, Math.min(params.limit ?? 10, 50));
  const data = await rampFetch(apiKey, `/transactions?page_size=${limit}`);
  const transactions = (data.data ?? data) as Array<Record<string, unknown>>;
  return {
    transactions: transactions.slice(0, limit).map((t) => ({
      id: t.id,
      amount: t.amount,
      currency_code: t.currency_code,
      merchant_name: t.merchant_name ?? t.merchant_descriptor,
      card_holder_name: (t.card_holder as Record<string, unknown>)?.first_name ?? null,
      category: t.sk_category_name,
      state: t.state,
      user_transaction_time: t.user_transaction_time,
      memo: t.memo,
    })),
  };
}

export async function getSpendingSummary(
  apiKey: string,
  params: { period?: string }
) {
  // Ramp doesn't have a direct spending summary endpoint,
  // so we aggregate from transactions
  const data = await rampFetch(apiKey, `/transactions?page_size=50`);
  const transactions = (data.data ?? data) as Array<Record<string, unknown>>;

  let total = 0;
  const byCategory: Record<string, number> = {};

  for (const t of transactions) {
    const amount = Number(t.amount ?? 0);
    total += amount;
    const cat = (t.sk_category_name as string) ?? "Uncategorized";
    byCategory[cat] = (byCategory[cat] ?? 0) + amount;
  }

  const categories = Object.entries(byCategory)
    .map(([name, amount]) => ({ name, amount }))
    .sort((a, b) => b.amount - a.amount);

  return {
    period: params.period ?? "recent",
    total_spend: total,
    transaction_count: transactions.length,
    categories,
  };
}
