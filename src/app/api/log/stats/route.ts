import { NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase";
import { requireSuperAdmin } from "@/lib/auth";
import { DEFAULT_MARKUP_MULTIPLIER } from "@/lib/models";

const PAYMENT_FEE_RATE = 0.029;
const PAYMENT_FEE_FIXED = 0.30;

// Paginate through all rows — Supabase caps at 1000 per request
async function fetchAllMessages(supabase: ReturnType<typeof getSupabaseServer>) {
  const PAGE = 1000;
  const all: { cost: string | null; model: string | null; tokens_in: number | null; tokens_out: number | null; created_at: string }[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from("chat_messages")
      .select("cost, model, tokens_in, tokens_out, created_at")
      .order("created_at", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return all;
}

async function fetchAllSettlements(supabase: ReturnType<typeof getSupabaseServer>) {
  const PAGE = 1000;
  const all: { amount: string; status: string; created_at: string; markup_multiplier: string | null }[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from("settlement_history")
      .select("amount, status, created_at, markup_multiplier")
      .in("status", ["succeeded", "bonus_credit"])
      .order("created_at", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return all;
}

// GET /api/log/stats — aggregate spend stats across all users for the MeterBar (superadmin only)
export async function GET() {
  const auth = await requireSuperAdmin();
  if (auth instanceof NextResponse) return auth;

  try {
    const supabase = getSupabaseServer();

    // Fetch global markup multiplier from app_config
    const { data: configRow } = await supabase
      .from("app_config")
      .select("markup_multiplier")
      .eq("id", "global")
      .single();
    const markupMultiplier = Number(configRow?.markup_multiplier) || DEFAULT_MARKUP_MULTIPLIER;

    // Fetch ALL messages (paginated) — no cost filter so tokens are counted accurately
    const messages = await fetchAllMessages(supabase);

    // Fetch total_cost from chat_sessions (source of truth for lifetime spend)
    // Only count main workspaces (not subtracks) to avoid double-counting
    const { data: sessionCosts } = await supabase
      .from("chat_sessions")
      .select("total_cost")
      .eq("is_subtrack", false)
      .is("deleted_at", null);

    const sessionTotalSpend = (sessionCosts ?? []).reduce(
      (sum, s) => sum + (Number(s.total_cost) || 0),
      0,
    );

    // Count debates from chat_messages where model='debate' (reliable, not fire-and-forget)
    const { count: debateCount } = await supabase
      .from("chat_messages")
      .select("id", { count: "exact", head: true })
      .eq("model", "debate")
      .eq("role", "assistant");

    // Count forks from chat_sessions where is_subtrack=true (actual fork records)
    const { count: forkCount } = await supabase
      .from("chat_sessions")
      .select("id", { count: "exact", head: true })
      .eq("is_subtrack", true)
      .is("deleted_at", null);

    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    const dayMs = 24 * 60 * 60 * 1000;

    // Calculate Monday of current week
    const day = now.getDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    const monday = new Date(now);
    monday.setDate(now.getDate() + mondayOffset);
    monday.setHours(0, 0, 0, 0);
    const weekStart = monday.toISOString().slice(0, 10);

    const monthStr = todayStr.slice(0, 7); // "YYYY-MM"

    let messageTotalSpend = 0;
    let todaySpend = 0;
    let weekSpend = 0;
    let monthSpend = 0;
    let totalTokensIn = 0;
    let totalTokensOut = 0;
    const totalMessages = messages.length;
    const byModel: Record<string, { cost: number; count: number; tokensIn: number; tokensOut: number }> = {};

    // Count first message date for daily average calculation
    let firstMessageDate: string | null = null;

    // Build time-series data for Liveline charts (daily buckets)
    const spendByBucket: Record<number, number> = {};
    const tokensByBucket: Record<number, number> = {};
    const messagesByBucket: Record<number, number> = {};

    for (const m of messages) {
      const cost = Number(m.cost) || 0;
      const tokIn = Number(m.tokens_in) || 0;
      const tokOut = Number(m.tokens_out) || 0;
      const createdAt = m.created_at as string;
      const dateStr = createdAt?.slice(0, 10) ?? "";

      messageTotalSpend += cost;
      totalTokensIn += tokIn;
      totalTokensOut += tokOut;

      if (dateStr === todayStr) todaySpend += cost;
      if (dateStr >= weekStart) weekSpend += cost;
      if (dateStr.startsWith(monthStr)) monthSpend += cost;

      if (!firstMessageDate || dateStr < firstMessageDate) {
        firstMessageDate = dateStr;
      }

      // By-model breakdown (only count messages that have a model)
      const model = (m.model as string) ?? "unknown";
      if (!byModel[model]) byModel[model] = { cost: 0, count: 0, tokensIn: 0, tokensOut: 0 };
      byModel[model].cost += cost;
      byModel[model].count += 1;
      byModel[model].tokensIn += tokIn;
      byModel[model].tokensOut += tokOut;

      // Time-series buckets
      if (createdAt) {
        const t = new Date(createdAt);
        // Daily buckets — Liveline expects Unix seconds
        const bucketTs = Math.floor(new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime() / 1000);
        spendByBucket[bucketTs] = (spendByBucket[bucketTs] || 0) + cost;
        tokensByBucket[bucketTs] = (tokensByBucket[bucketTs] || 0) + tokIn + tokOut;
        messagesByBucket[bucketTs] = (messagesByBucket[bucketTs] || 0) + 1;
      }
    }

    // Use the higher of session totals vs message totals (session is source of truth,
    // but message-level may have more granular data in some cases)
    const totalSpend = Math.max(sessionTotalSpend, messageTotalSpend);

    // ── Settlement & Profit ──
    const settlements = await fetchAllSettlements(supabase);
    let totalSettled = 0;
    let todaySettled = 0;
    let paymentFees = 0;
    let totalInferenceCost = 0;
    const profitByBucket: Record<number, number> = {};

    for (const s of settlements) {
      const amt = Number(s.amount) || 0;
      const createdAt = s.created_at as string;
      const dateStr = createdAt?.slice(0, 10) ?? "";
      // Use per-row markup if available, fall back to current global for legacy rows
      const rowMarkup = Number(s.markup_multiplier) || markupMultiplier;

      totalSettled += amt;
      if (dateStr === todayStr) todaySettled += amt;

      // Payment fees only on card charges, not bonus credit
      const fee = s.status === "succeeded" ? amt * PAYMENT_FEE_RATE + PAYMENT_FEE_FIXED : 0;
      paymentFees += fee;

      // Per-settlement profit: revenue - inference cost - payment fee
      const rowInferenceCost = amt / rowMarkup;
      totalInferenceCost += rowInferenceCost;
      const profit = amt - rowInferenceCost - fee;

      if (createdAt) {
        const t = new Date(createdAt);
        const bucketTs = Math.floor(new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime() / 1000);
        profitByBucket[bucketTs] = (profitByBucket[bucketTs] || 0) + profit;
      }
    }

    const totalProfit = totalSettled - totalInferenceCost - paymentFees;

    // Cumulative profit timeline
    const profitBuckets = Object.keys(profitByBucket).map(Number).sort((a, b) => a - b);
    let cumProfit = 0;
    const profitTimeline = profitBuckets.map((ts) => {
      cumProfit += profitByBucket[ts];
      return { time: ts, value: Math.round(cumProfit * 100) / 100 };
    });

    // Calculate averages
    const daysSinceFirst = firstMessageDate
      ? Math.max(1, Math.floor((now.getTime() - new Date(firstMessageDate).getTime()) / dayMs) + 1)
      : 1;
    const daysIntoWeek = Math.max(1, Math.floor((now.getTime() - monday.getTime()) / dayMs) + 1);
    const daysIntoMonth = Math.max(1, now.getDate());

    // Convert to cumulative time-series arrays sorted by time
    const spendBuckets = Object.keys(spendByBucket).map(Number).sort((a, b) => a - b);
    let cumSpend = 0;
    const spendTimeline = spendBuckets.map((ts) => {
      cumSpend += spendByBucket[ts];
      return { time: ts, value: Math.round(cumSpend * 100) / 100 };
    });

    const tokenBuckets = Object.keys(tokensByBucket).map(Number).sort((a, b) => a - b);
    let cumTokens = 0;
    const tokensTimeline = tokenBuckets.map((ts) => {
      cumTokens += tokensByBucket[ts];
      return { time: ts, value: cumTokens };
    });

    const messageBuckets = Object.keys(messagesByBucket).map(Number).sort((a, b) => a - b);
    let cumMessages = 0;
    const messagesTimeline = messageBuckets.map((ts) => {
      cumMessages += messagesByBucket[ts];
      return { time: ts, value: cumMessages };
    });

    const counts = {
      debates: debateCount ?? 0,
      dissects: 0,
      forks: forkCount ?? 0,
      documents: 0,
    };

    return NextResponse.json(
      {
        totalSpend,
        todaySpend,
        weekSpend,
        monthSpend,
        dailyAverage: totalSpend / daysSinceFirst,
        weeklyAverage: weekSpend / daysIntoWeek * 7,
        monthlyAverage: monthSpend / daysIntoMonth * 30,
        totalSettled,
        todaySettled,
        paymentFees,
        inferenceCost: totalInferenceCost,
        totalProfit,
        profitTimeline,
        totalTokensIn,
        totalTokensOut,
        totalMessages,
        byModel,
        counts,
        spendTimeline,
        tokensTimeline,
        messagesTimeline,
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
        },
      }
    );
  } catch (err) {
    console.error("Failed to fetch log stats:", err);
    return NextResponse.json(
      { error: "Failed to fetch stats" },
      { status: 500 }
    );
  }
}
