import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { verifySession } from "@/lib/auth/dal";
import { generateDailyReport } from "@/lib/world-tracker/ai-report";

const eventSummarySchema = z.object({
  title: z.string(),
  category: z.enum(["finance", "politics", "geopolitics", "aviation"]),
  importance: z.enum(["critical", "high", "medium", "low"]),
  location: z.object({ country: z.string() }),
  tickers: z.array(z.string()),
});

const requestSchema = z.object({ events: z.array(eventSummarySchema).max(200) });

export async function POST(request: NextRequest) {
  await verifySession();

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const result = await generateDailyReport(parsed.data.events);
  if (!result.data) {
    return NextResponse.json({ error: result.meta.message ?? "Report generation failed." }, { status: 502 });
  }

  return NextResponse.json({ report: result.data, generatedAt: result.meta.timestamp });
}
