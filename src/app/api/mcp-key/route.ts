import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getSupabaseServer } from "@/lib/supabase";
import { encryptToken, decryptToken } from "@/lib/oauth";
import crypto from "crypto";

function generateMcpKey(): string {
  const raw = crypto.randomBytes(24).toString("base64url");
  return `mk_${raw}`;
}

function hashKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex");
}

// GET /api/mcp-key — fetch the user's current MCP API key
export async function GET() {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { userId } = auth;

  const supabase = getSupabaseServer();
  const { data } = await supabase
    .from("mcp_keys")
    .select("encrypted_key")
    .eq("user_id", userId)
    .eq("active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) {
    return NextResponse.json({ key: null });
  }

  try {
    const key = decryptToken(data.encrypted_key);
    return NextResponse.json({ key });
  } catch {
    // If decryption fails (key rotation etc.), treat as no key
    return NextResponse.json({ key: null });
  }
}

// POST /api/mcp-key — generate a new MCP API key (revokes previous)
export async function POST() {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { userId } = auth;

  const supabase = getSupabaseServer();

  // Revoke any existing active keys
  await supabase
    .from("mcp_keys")
    .update({ active: false })
    .eq("user_id", userId)
    .eq("active", true);

  // Generate and store new key
  const key = generateMcpKey();
  const keyHash = hashKey(key);
  const keyPrefix = key.slice(0, 7);
  const encryptedKey = encryptToken(key);

  const { error } = await supabase.from("mcp_keys").insert({
    user_id: userId,
    key_hash: keyHash,
    key_prefix: keyPrefix,
    encrypted_key: encryptedKey,
  });

  if (error) {
    return NextResponse.json(
      { error: "Failed to create key" },
      { status: 500 },
    );
  }

  return NextResponse.json({ key });
}
