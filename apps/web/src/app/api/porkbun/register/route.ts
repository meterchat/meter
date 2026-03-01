import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getSupabaseServer } from "@/lib/supabase";
import { registerDomain } from "@/lib/connectors/porkbun";

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { userId } = auth;

  const { domain } = await req.json();
  if (!domain || typeof domain !== "string") {
    return NextResponse.json({ error: "domain is required" }, { status: 400 });
  }

  // Look up user's email for registrant contact info
  const supabase = getSupabaseServer();
  const { data: user } = await supabase
    .from("meter_users")
    .select("email")
    .eq("id", userId)
    .single();

  const email = user?.email ?? "domains@meter.chat";

  try {
    const result = await registerDomain(domain, { email });
    const priceUsd = result.priceInCents / 100;

    return NextResponse.json({
      success: true,
      domain: result.domain,
      price: priceUsd,
      orderId: result.orderId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[porkbun/register] error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
