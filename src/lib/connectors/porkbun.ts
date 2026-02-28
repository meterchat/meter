/**
 * Porkbun connector — domain availability + registration.
 *
 * Meter acts as a reseller: platform-level Porkbun account (env vars)
 * registers domains with the user's contact info. Cost is billed to
 * the user via Stripe through the existing settlement flow.
 *
 * API docs: https://porkbun.com/api/json/v3/documentation
 */

const PORKBUN_API = "https://api.porkbun.com/api/json/v3";

function getAuth() {
  const apikey = process.env.PORKBUN_API_KEY;
  const secretapikey = process.env.PORKBUN_SECRET_KEY;
  if (!apikey || !secretapikey) {
    throw new Error("Porkbun API keys not configured (PORKBUN_API_KEY / PORKBUN_SECRET_KEY).");
  }
  return { apikey, secretapikey };
}

/* ─── Rate limiter (Porkbun: ~1 check per 10s) ──────────────── */

let lastCheckTime = 0;
const MIN_CHECK_INTERVAL = 10_500;

async function rateLimited<T>(fn: () => Promise<T>): Promise<T> {
  const elapsed = Date.now() - lastCheckTime;
  if (elapsed < MIN_CHECK_INTERVAL) {
    await new Promise((r) => setTimeout(r, MIN_CHECK_INTERVAL - elapsed));
  }
  lastCheckTime = Date.now();
  return fn();
}

/* ─── HTTP helper ────────────────────────────────────────────── */

async function porkbunPost<T = Record<string, unknown>>(
  path: string,
  extra?: Record<string, unknown>
): Promise<T> {
  const auth = getAuth();
  const res = await fetch(`${PORKBUN_API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...auth, ...extra }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "unknown error");
    throw new Error(`Porkbun API error (${res.status}): ${text}`);
  }

  const data = (await res.json()) as Record<string, unknown>;
  if (data.status === "ERROR") {
    throw new Error(`Porkbun: ${data.message ?? "Unknown error"}`);
  }
  return data as T;
}

/* ─── Normalize domain input ─────────────────────────────────── */

function cleanDomain(domain: string): string {
  return domain
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/+$/, "")
    .trim()
    .toLowerCase();
}

/* ─── Domain availability check ──────────────────────────────── */

export interface DomainCheckResult {
  domain: string;
  tld: string;
  available: boolean;
  price: string;
  regularPrice: string;
  premium: boolean;
  renewalPrice: string | null;
  transferPrice: string | null;
  minDuration: number;
}

export async function checkDomain(domain: string): Promise<DomainCheckResult> {
  const clean = cleanDomain(domain);
  const tld = clean.split(".").pop() ?? "";

  const data = await rateLimited(() =>
    porkbunPost(`/domain/checkDomain/${clean}`)
  );

  // Porkbun nests the check result inside a "response" key
  const resp = ((data as Record<string, unknown>).response ?? data) as Record<string, unknown>;
  const additional = (resp.additional ?? {}) as Record<string, Record<string, string>>;

  return {
    domain: clean,
    tld,
    available: resp.avail === true || resp.avail === "yes",
    price: String(resp.price ?? "0"),
    regularPrice: String(resp.regularPrice ?? resp.price ?? "0"),
    premium: resp.premium === true || resp.premium === "yes",
    renewalPrice: additional.renewal?.price ?? null,
    transferPrice: additional.transfer?.price ?? null,
    minDuration: Number(resp.minDuration ?? 1),
  };
}

/* ─── Domain registration ────────────────────────────────────── */

export interface DomainRegisterResult {
  domain: string;
  priceInCents: number;
  orderId: string;
  creditBalance: string;
}

export async function registerDomain(
  domain: string,
  contact: { email: string; firstName?: string; lastName?: string }
): Promise<DomainRegisterResult> {
  const clean = cleanDomain(domain);

  // Re-check availability to guard against race condition
  const check = await checkDomain(clean);
  if (!check.available) {
    throw new Error(`${clean} is no longer available for registration.`);
  }

  const data = await porkbunPost(`/domain/create/${clean}`, {
    agreement: "1",
    ...(contact.firstName ? { firstName: contact.firstName } : {}),
    ...(contact.lastName ? { lastName: contact.lastName } : {}),
    email: contact.email,
  });

  return {
    domain: String(data.domain ?? clean),
    priceInCents: Number(data.price ?? 0),
    orderId: String(data.orderId ?? ""),
    creditBalance: String(data.accountCreditBalance ?? "0"),
  };
}

/* ─── TLD pricing ────────────────────────────────────────────── */

export async function getPricing(): Promise<
  Record<string, { registration: string; renewal: string; transfer: string }>
> {
  const data = await porkbunPost("/pricing/get");
  return (data.pricing ?? {}) as Record<
    string,
    { registration: string; renewal: string; transfer: string }
  >;
}
