import { NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase";

// GET /api/log/stats — aggregate spend stats across all users for the MeterBar
export async function GET() {
  try {
    const supabase = getSupabaseServer();

    // Fetch aggregate stats from chat_messages table (messages with cost data for spend calculations)
    const { data: msgStats, error: msgError } = await supabase
      .from("chat_messages")
      .select("cost, model, tokens_in, tokens_out, created_at")
      .not("cost", "is", null);

    if (msgError) throw msgError;

    // Count ALL messages (including those without cost) for accurate message total
    const { count: allMessageCount } = await supabase
      .from("chat_messages")
      .select("id", { count: "exact", head: true });

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

    let messageTotalSpend = 0;
    let todaySpend = 0;
    let weekSpend = 0;
    let monthSpend = 0;
    let totalTokensIn = 0;
    let totalTokensOut = 0;
    let totalMessages = allMessageCount ?? messages.length;
    const byModel: Record<string, { cost: number; count: number; tokensIn: number; tokensOut: number }> = {};

    // Count first message date for daily average calculation
    let firstMessageDate: string | null = null;

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

      const model = (m.model as string) ?? "unknown";
      if (!byModel[model]) byModel[model] = { cost: 0, count: 0, tokensIn: 0, tokensOut: 0 };
      byModel[model].cost += cost;
      byModel[model].count += 1;
      byModel[model].tokensIn += tokIn;
      byModel[model].tokensOut += tokOut;
    }

    // Use the higher of session totals vs message totals (session is source of truth,
    // but message-level may have more granular data in some cases)
    const totalSpend = Math.max(sessionTotalSpend, messageTotalSpend);

    // Calculate averages
    const daysSinceFirst = firstMessageDate
      ? Math.max(1, Math.floor((now.getTime() - new Date(firstMessageDate).getTime()) / dayMs) + 1)
      : 1;
    const daysIntoWeek = Math.max(1, Math.floor((now.getTime() - monday.getTime()) / dayMs) + 1);
    const daysIntoMonth = Math.max(1, now.getDate());

    // Build time-series data for Liveline charts
    // Use daily buckets over all time (not just 7 days) so charts always render
    const spendByBucket: Record<number, number> = {};
    const tokensByBucket: Record<number, number> = {};

    for (const m of messages) {
      const createdAt = m.created_at as string;
      if (!createdAt) continue;
      const t = new Date(createdAt);
      // Use daily buckets — more data points, charts always render
      // Liveline expects Unix seconds, not milliseconds
      const bucketTs = Math.floor(new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime() / 1000);
      const cost = Number(m.cost) || 0;
      const tokens = (Number(m.tokens_in) || 0) + (Number(m.tokens_out) || 0);
      spendByBucket[bucketTs] = (spendByBucket[bucketTs] || 0) + cost;
      tokensByBucket[bucketTs] = (tokensByBucket[bucketTs] || 0) + tokens;
    }

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
