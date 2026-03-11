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

  try {
    const supabase = getSupabaseServer();
    const { data, error } = await supabase
      .from("mcp_keys")
      .select("encrypted_key")
      .eq("user_id", userId)
      .eq("active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error("[mcp-key GET] Supabase error:", error.message, error.code);
      return NextResponse.json(
        { error: `Database error: ${error.message}` },
        { status: 500 },
      );
    }

    if (!data) {
      return NextResponse.json({ key: null });
    }

    const key = decryptToken(data.encrypted_key);
    return NextResponse.json({ key });
  } catch (err) {
    console.error("[mcp-key GET] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 },
    );
  }
}

// POST /api/mcp-key — generate a new MCP API key (revokes previous)
export async function POST() {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { userId } = auth;

  try {
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
      console.error("[mcp-key POST] Supabase insert error:", error.message, error.code, error.details);
      return NextResponse.json(
        { error: `Failed to create key: ${error.message}` },
        { status: 500 },
      );
    }

    return NextResponse.json({ key });
  } catch (err) {
    console.error("[mcp-key POST] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 },
    );
  }
}
