import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { verifySession } from "@/lib/auth/dal";
import { generateTickerInsight } from "@/lib/markets/insights";

const SummarySchema = z.object({
  symbol: z.string().min(1).max(10),
  timeframe: z.string().min(1).max(20),
  barCount: z.number().int().nonnegative(),
  latestClose: z.number(),
  changePercent: z.number(),
  periodHigh: z.number(),
  periodLow: z.number(),
  latestVolume: z.number(),
  averageVolume: z.number(),
});

export async function POST(request: NextRequest) {
  await verifySession();

  const parsed = SummarySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const result = await generateTickerInsight(parsed.data);
  if (!result.data) {
    return NextResponse.json({ error: result.meta.message ?? "Insight generation failed." }, { status: 502 });
  }

  return NextResponse.json({ insight: result.data, generatedAt: result.meta.timestamp });
}
