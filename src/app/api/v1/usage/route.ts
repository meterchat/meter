import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase";

// GET — usage records for a wallet
export async function GET(req: NextRequest) {
  const supabase = getSupabaseServer();
  const walletAddress = req.nextUrl.searchParams.get("walletAddress");
  if (!walletAddress) {
    return NextResponse.json({ error: "walletAddress required" }, { status: 400 });
  }

  const { data: user } = await supabase
    .from("users")
    .select("id")
    .eq("wallet_address", walletAddress)
    .single();

  if (!user) {
    return NextResponse.json({ records: [] });
  }

  const { data: records } = await supabase
    .from("usage_records")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(100);

  return NextResponse.json({ records: records ?? [] });
}
