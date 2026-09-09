import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { verifySession } from "@/lib/auth/dal";
import { classifyHeadlines } from "@/lib/news/news-ai-summarizer";

const newsItemSchema = z.object({
  id: z.number(),
  headline: z.string(),
  summary: z.string(),
  source: z.string(),
  url: z.string(),
  publishedAt: z.string(),
  imageUrl: z.string().nullable(),
});

const requestSchema = z.object({ items: z.array(newsItemSchema).max(40) });

export async function POST(request: NextRequest) {
  await verifySession();

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const result = await classifyHeadlines(parsed.data.items);
  if (!result.data) {
    return NextResponse.json({ error: result.meta.message ?? "Summarization failed." }, { status: 502 });
  }

  return NextResponse.json({ classifications: result.data, generatedAt: result.meta.timestamp });
}
