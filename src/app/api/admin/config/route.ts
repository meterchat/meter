import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth";
import { getSupabaseServer } from "@/lib/supabase";
import { MODELS, DEFAULT_MARKUP_MULTIPLIER } from "@/lib/models";
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
    return NextResponse.json(
      { markupMultiplier: DEFAULT_MARKUP_MULTIPLIER, enabledModels: [], enabledCommands: [], freeUsdCredit: 0, bonusCreditLimit: 100, bonusCreditAmount: 10 },
    );
  }

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

  const supabase = getSupabaseServer();
  const { error } = await supabase
    .from("app_config")
    .upsert({ id: "global", ...updates });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Return updated config
  const { data } = await supabase.from("app_config").select("*").eq("id", "global").single();
  if (!data) {
    return NextResponse.json({ error: "Failed to read config after save" }, { status: 500 });
  }
  return NextResponse.json({
    markupMultiplier: Number(data.markup_multiplier ?? DEFAULT_MARKUP_MULTIPLIER),
    enabledModels: data.enabled_models ?? [],
    enabledCommands: data.enabled_commands ?? [],
    freeUsdCredit: Number(data.free_usd_credit ?? 0),
    bonusCreditLimit: Number(data.bonus_credit_limit ?? 100),
    bonusCreditAmount: Number(data.bonus_credit_amount ?? 10),
  });
}
