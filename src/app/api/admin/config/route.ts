import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth";
import { getSupabaseServer } from "@/lib/supabase";
import { MODELS } from "@/lib/models";
import { SLASH_COMMANDS } from "@/lib/connectors";

export const dynamic = "force-dynamic";

const VALID_MODEL_IDS = new Set(MODELS.filter((m) => m.id !== "auto").map((m) => m.id));
const VALID_COMMAND_NAMES = new Set(SLASH_COMMANDS.map((c) => c.command));

/** GET /api/admin/config — returns global app config (superadmin only) */
export async function GET() {
  const auth = await requireSuperAdmin();
  if (auth instanceof NextResponse) return auth;

  const supabase = getSupabaseServer();
  const { data, error } = await supabase
    .from("app_config")
    .select("*")
    .eq("id", "global")
    .single();

  if (error || !data) {
    console.warn("[admin-config] GET: no app_config row found, returning defaults.", error?.message);
    return NextResponse.json(
      { markupMultiplier: 2.5, enabledModels: [], enabledCommands: [], freeUsdCredit: 0, bonusCreditLimit: 100, bonusCreditAmount: 10 },
    );
  }

  console.log("[admin-config] GET:", JSON.stringify({
    enabled_models: data.enabled_models,
    enabled_commands: data.enabled_commands,
    markup_multiplier: data.markup_multiplier,
  }));
  return NextResponse.json({
    markupMultiplier: Number(data.markup_multiplier),
    enabledModels: data.enabled_models ?? [],
    enabledCommands: data.enabled_commands ?? [],
    freeUsdCredit: Number(data.free_usd_credit ?? 0),
    bonusCreditLimit: Number(data.bonus_credit_limit ?? 100),
    bonusCreditAmount: Number(data.bonus_credit_amount ?? 10),
  });
}

/** PUT /api/admin/config — partial update of global config (superadmin only) */
export async function PUT(req: NextRequest) {
  const auth = await requireSuperAdmin();
  if (auth instanceof NextResponse) return auth;

  const body = await req.json();
  console.log("[admin-config] PUT request body:", JSON.stringify(body));
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString(), updated_by: auth.userId };

  if (body.markupMultiplier != null) {
    const m = Number(body.markupMultiplier);
    if (isNaN(m) || m < 1) {
      return NextResponse.json({ error: "markupMultiplier must be a number >= 1" }, { status: 400 });
    }
    updates.markup_multiplier = m;
  }

  if (body.enabledModels != null) {
    if (!Array.isArray(body.enabledModels)) {
      return NextResponse.json({ error: "enabledModels must be an array" }, { status: 400 });
    }
    for (const id of body.enabledModels) {
      if (!VALID_MODEL_IDS.has(id)) {
        return NextResponse.json({ error: `Unknown model: ${id}` }, { status: 400 });
      }
    }
    updates.enabled_models = body.enabledModels;
  }

  if (body.enabledCommands != null) {
    if (!Array.isArray(body.enabledCommands)) {
      return NextResponse.json({ error: "enabledCommands must be an array" }, { status: 400 });
    }
    for (const name of body.enabledCommands) {
      if (!VALID_COMMAND_NAMES.has(name)) {
        return NextResponse.json({ error: `Unknown command: ${name}` }, { status: 400 });
      }
    }
    updates.enabled_commands = body.enabledCommands;
  }

  if (body.freeUsdCredit != null) {
    const c = Number(body.freeUsdCredit);
    if (isNaN(c) || c < 0) {
      return NextResponse.json({ error: "freeUsdCredit must be a number >= 0" }, { status: 400 });
    }
    updates.free_usd_credit = c;
  }

  if (body.bonusCreditLimit != null) {
    const l = Number(body.bonusCreditLimit);
    if (isNaN(l) || l < 0 || !Number.isInteger(l)) {
      return NextResponse.json({ error: "bonusCreditLimit must be a non-negative integer" }, { status: 400 });
    }
    updates.bonus_credit_limit = l;
  }

  if (body.bonusCreditAmount != null) {
    const a = Number(body.bonusCreditAmount);
    if (isNaN(a) || a < 0) {
      return NextResponse.json({ error: "bonusCreditAmount must be a number >= 0" }, { status: 400 });
    }
    updates.bonus_credit_amount = a;
  }

  console.log("[admin-config] Upserting updates:", JSON.stringify(updates));
  const supabase = getSupabaseServer();
  const { error } = await supabase
    .from("app_config")
    .upsert({ id: "global", ...updates });

  if (error) {
    console.error("[admin-config] Upsert FAILED:", error.message, error.details, error.hint);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  console.log("[admin-config] Upsert succeeded");

  // Return updated config
  const { data, error: readError } = await supabase.from("app_config").select("*").eq("id", "global").single();
  if (readError || !data) {
    console.error("[admin-config] Read-back FAILED:", readError?.message);
    return NextResponse.json({ error: "Failed to read config after save" }, { status: 500 });
  }
  console.log("[admin-config] Read-back data:", JSON.stringify({
    enabled_models: data.enabled_models,
    enabled_commands: data.enabled_commands,
    markup_multiplier: data.markup_multiplier,
  }));
  return NextResponse.json({
    markupMultiplier: Number(data.markup_multiplier ?? 2.5),
    enabledModels: data.enabled_models ?? [],
    enabledCommands: data.enabled_commands ?? [],
    freeUsdCredit: Number(data.free_usd_credit ?? 0),
    bonusCreditLimit: Number(data.bonus_credit_limit ?? 100),
    bonusCreditAmount: Number(data.bonus_credit_amount ?? 10),
  });
}
