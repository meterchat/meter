// Banker mode Stripe connector — reads financial data from user's connected Stripe account.
// Uses raw fetch against the Stripe API (no SDK dependency).

const STRIPE_API = "https://api.stripe.com/v1";

async function stripeGet(path: string, accessToken: string, params?: Record<string, string>) {
  const url = new URL(`${STRIPE_API}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) url.searchParams.set(k, v);
    }
  }
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Stripe API ${path} failed: ${res.status} ${text.slice(0, 200)}`);
  }
  return res.json();
}

export async function listPayments(
  accessToken: string,
  params: { limit?: number; status?: string }
) {
  const limit = Math.max(1, Math.min(params.limit ?? 10, 20));
  const data = await stripeGet("/payment_intents", accessToken, {
    limit: String(limit),
  });

  const filtered = params.status
    ? data.data.filter((p: Record<string, unknown>) => p.status === params.status)
    : data.data;

  return {
    payments: filtered.map((p: Record<string, unknown>) => ({
      id: p.id,
      amount: (p.amount as number) / 100,
      currency: p.currency,
      status: p.status,
      description: p.description,
      created: p.created,
      customer: typeof p.customer === "string" ? p.customer : (p.customer as Record<string, unknown>)?.id ?? null,
    })),
  };
}

export async function getBalance(accessToken: string) {
  const balance = await stripeGet("/balance", accessToken);
  return {
    available: (balance.available as Array<{ amount: number; currency: string }>).map((b) => ({
      amount: b.amount / 100,
      currency: b.currency,
    })),
    pending: (balance.pending as Array<{ amount: number; currency: string }>).map((b) => ({
      amount: b.amount / 100,
      currency: b.currency,
    })),
  };
}

export async function listSubscriptions(
  accessToken: string,
  params: { status?: string }
) {
  const data = await stripeGet("/subscriptions", accessToken, {
    limit: "20",
    status: params.status ?? "all",
  });

  return {
    subscriptions: (data.data as Array<Record<string, unknown>>).map((s) => ({
      id: s.id,
      status: s.status,
      customer: typeof s.customer === "string" ? s.customer : (s.customer as Record<string, unknown>)?.id ?? null,
      currentPeriodEnd: s.current_period_end ?? null,
      cancelAtPeriodEnd: s.cancel_at_period_end,
      price: (s.items as Record<string, unknown[]>)?.data?.[0]
        ? ((s.items as { data: Array<{ price: { unit_amount: number; currency: string } }> }).data[0]?.price?.unit_amount ?? 0) / 100
        : null,
      currency: (s.items as { data: Array<{ price: { currency: string } }> })?.data?.[0]?.price?.currency ?? null,
    })),
  };
}
