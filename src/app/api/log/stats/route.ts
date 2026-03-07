import { NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase";

// GET /api/log/stats — aggregate spend stats across all users for the MeterBar
export async function GET() {
  try {
    const supabase = getSupabaseServer();

    // Fetch aggregate stats from messages table
    const { data: msgStats, error: msgError } = await supabase
      .from("messages")
      .select("cost, model, tokens_in, tokens_out, created_at")
      .not("cost", "is", null);

    if (msgError) throw msgError;

    const messages = msgStats ?? [];
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

    let totalSpend = 0;
    let todaySpend = 0;
    let weekSpend = 0;
    let monthSpend = 0;
    let totalTokensIn = 0;
    let totalTokensOut = 0;
    let totalMessages = messages.length;
    const byModel: Record<string, { cost: number; count: number; tokensIn: number; tokensOut: number }> = {};

    // Count first message date for daily average calculation
    let firstMessageDate: string | null = null;

    for (const m of messages) {
      const cost = Number(m.cost) || 0;
      const tokIn = Number(m.tokens_in) || 0;
      const tokOut = Number(m.tokens_out) || 0;
      const createdAt = m.created_at as string;
      const dateStr = createdAt?.slice(0, 10) ?? "";

      totalSpend += cost;
      totalTokensIn += tokIn;
      totalTokensOut += tokOut;

      if (dateStr === todayStr) todaySpend += cost;
      if (dateStr >= weekStart) weekSpend += cost;
      if (dateStr.startsWith(monthStr)) monthSpend += cost;

      if (!firstMessageDate || dateStr < firstMessageDate) {
        firstMessageDate = dateStr;
      }

      const model = (m.model as string) ?? "unknown";
      if (!byModel[model]) byModel[model] = { cost: 0, count: 0, tokensIn: 0, tokensOut: 0 };
      byModel[model].cost += cost;
      byModel[model].count += 1;
      byModel[model].tokensIn += tokIn;
      byModel[model].tokensOut += tokOut;
    }

    // Calculate averages
    const daysSinceFirst = firstMessageDate
      ? Math.max(1, Math.floor((now.getTime() - new Date(firstMessageDate).getTime()) / dayMs) + 1)
      : 1;
    const daysIntoWeek = Math.max(1, Math.floor((now.getTime() - monday.getTime()) / dayMs) + 1);
    const daysIntoMonth = Math.max(1, now.getDate());

    // Build time-series data for Liveline charts (hourly buckets, last 7 days)
    const sevenDaysAgo = new Date(now.getTime() - 7 * dayMs);
    const spendByHour: Record<number, number> = {};
    const tokensByHour: Record<number, number> = {};

    for (const m of messages) {
      const createdAt = m.created_at as string;
      if (!createdAt) continue;
      const t = new Date(createdAt);
      if (t < sevenDaysAgo) continue;
      // Round to hour
      const hourTs = new Date(t.getFullYear(), t.getMonth(), t.getDate(), t.getHours()).getTime();
      const cost = Number(m.cost) || 0;
      const tokens = (Number(m.tokens_in) || 0) + (Number(m.tokens_out) || 0);
      spendByHour[hourTs] = (spendByHour[hourTs] || 0) + cost;
      tokensByHour[hourTs] = (tokensByHour[hourTs] || 0) + tokens;
    }

    // Convert to cumulative time-series arrays sorted by time
    const spendHours = Object.keys(spendByHour).map(Number).sort((a, b) => a - b);
    let cumSpend = 0;
    const spendTimeline = spendHours.map((ts) => {
      cumSpend += spendByHour[ts];
      return { time: ts, value: Math.round(cumSpend * 100) / 100 };
    });

    const tokenHours = Object.keys(tokensByHour).map(Number).sort((a, b) => a - b);
    let cumTokens = 0;
    const tokensTimeline = tokenHours.map((ts) => {
      cumTokens += tokensByHour[ts];
      return { time: ts, value: cumTokens };
    });

    // Fetch log entry counts for debates, dissects, forks
    const { data: logCounts } = await supabase
      .from("log_entries")
      .select("type");

    const counts = {
      debates: 0,
      dissects: 0,
      forks: 0,
      documents: 0,
    };

    for (const entry of logCounts ?? []) {
      if (entry.type === "debate_started") counts.debates++;
      if (entry.type === "path_forked") counts.forks++;
    }

    return NextResponse.json(
      {
        totalSpend,
        todaySpend,
        weekSpend,
        monthSpend,
        dailyAverage: totalSpend / daysSinceFirst,
        weeklyAverage: weekSpend / daysIntoWeek * 7,
        monthlyAverage: monthSpend / daysIntoMonth * 30,
        totalTokensIn,
        totalTokensOut,
        totalMessages,
        byModel,
        counts,
        spendTimeline,
        tokensTimeline,
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
