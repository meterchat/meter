import Stripe from "stripe";

function getStripeClient(accessToken: string) {
  return new Stripe(accessToken, {
    apiVersion: "2026-01-28.clover",
    typescript: true,
  });
}

export async function listPayments(
  accessToken: string,
  params: { limit?: number; status?: string }
) {
  const stripe = getStripeClient(accessToken);
  const limit = Math.max(1, Math.min(params.limit ?? 10, 20));
  const list = await stripe.paymentIntents.list({ limit });
  const filtered = params.status
    ? list.data.filter((p) => p.status === params.status)
    : list.data;

  return {
    payments: filtered.map((p) => ({
      id: p.id,
      amount: p.amount / 100,
      currency: p.currency,
      status: p.status,
      description: p.description,
      created: p.created,
      customer: typeof p.customer === "string" ? p.customer : p.customer?.id ?? null,
    })),
  };
}

export async function getBalance(accessToken: string) {
  const stripe = getStripeClient(accessToken);
  const balance = await stripe.balance.retrieve();
  return {
    available: balance.available.map((b) => ({
      amount: b.amount / 100,
      currency: b.currency,
    })),
    pending: balance.pending.map((b) => ({
      amount: b.amount / 100,
      currency: b.currency,
    })),
  };
}

export async function listSubscriptions(
  accessToken: string,
  params: { status?: string }
) {
  const stripe = getStripeClient(accessToken);
  const list = await stripe.subscriptions.list({
    limit: 20,
    status: (params.status as Stripe.SubscriptionListParams.Status) ?? "all",
  });
  return {
    subscriptions: list.data.map((s) => ({
      id: s.id,
      status: s.status,
      customer: typeof s.customer === "string" ? s.customer : s.customer?.id ?? null,
      currentPeriodEnd: (s as unknown as Record<string, unknown>).current_period_end ?? null,
      cancelAtPeriodEnd: s.cancel_at_period_end,
      price: s.items.data[0]?.price?.unit_amount ? s.items.data[0].price.unit_amount / 100 : null,
      currency: s.items.data[0]?.price?.currency ?? null,
    })),
  };
}
