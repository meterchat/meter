import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase";
import crypto from "crypto";

function generateApiKey(): string {
  const raw = crypto.randomBytes(24).toString("base64url");
  return `mk_${raw}`;
}

function hashKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex");
}

// GET — list keys for a wallet
export async function GET(req: NextRequest) {
  const supabase = getSupabaseServer();
  const walletAddress = req.nextUrl.searchParams.get("walletAddress");
  if (!walletAddress) {
    return NextResponse.json({ error: "walletAddress required" }, { status: 400 });
  }

  // Find user
  const { data: user } = await supabase
    .from("users")
    .select("id")
    .eq("wallet_address", walletAddress)
    .single();

  if (!user) {
    return NextResponse.json({ keys: [] });
  }

  const { data: keys } = await supabase
    .from("api_keys")
    .select("id, key_prefix, name, active, created_at, last_used_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  return NextResponse.json({ keys: keys ?? [] });
}

// POST — create a new key
export async function POST(req: NextRequest) {
  const supabase = getSupabaseServer();
  const { walletAddress } = await req.json();
  if (!walletAddress) {
    return NextResponse.json({ error: "walletAddress required" }, { status: 400 });
  }

  // Find or create user
  let { data: user } = await supabase
    .from("users")
    .select("id")
    .eq("wallet_address", walletAddress)
    .single();

  if (!user) {
    const { data: newUser, error } = await supabase
      .from("users")
      .insert({ wallet_address: walletAddress })
      .select("id")
      .single();

    if (error || !newUser) {
      return NextResponse.json({ error: "Failed to create user" }, { status: 500 });
    }
    user = newUser;
  }

  const key = generateApiKey();
  const keyHash = hashKey(key);
  const keyPrefix = key.slice(0, 7);

  const { error } = await supabase.from("api_keys").insert({
    user_id: user.id,
    key_hash: keyHash,
    key_prefix: keyPrefix,
  });

  if (error) {
    return NextResponse.json({ error: "Failed to create key" }, { status: 500 });
  }

  return NextResponse.json({ key, prefix: keyPrefix });
}

// DELETE — revoke a key (scoped to owning user)
export async function DELETE(req: NextRequest) {
  const supabase = getSupabaseServer();
  const id = req.nextUrl.searchParams.get("id");
  const walletAddress = req.nextUrl.searchParams.get("walletAddress");
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }
  if (!walletAddress) {
    return NextResponse.json({ error: "walletAddress required" }, { status: 400 });
  }

  const { data: user } = await supabase
    .from("users")
    .select("id")
    .eq("wallet_address", walletAddress)
    .single();

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const { error, count } = await supabase
    .from("api_keys")
    .update({ active: false })
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) {
    return NextResponse.json({ error: "Failed to revoke key" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
