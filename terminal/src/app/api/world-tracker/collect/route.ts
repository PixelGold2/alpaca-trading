import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { runCollectionCycle } from "@/lib/world-tracker/gdelt-provider";

/**
 * Runs one GDELT collection cycle on demand — the trigger point for 24/7
 * operation on hosting where a long-lived setInterval (see
 * instrumentation.ts) isn't reliable, e.g. stateless serverless. Point a
 * free external cron (GitHub Actions scheduled workflow, cron-job.org,
 * UptimeRobot, etc.) at this URL every few minutes. GET, not POST — most
 * free cron pingers just fetch a URL — and safe to call concurrently with
 * the in-process interval or with itself, since inserts are deduped at the
 * database level (see events-store.ts).
 */
export async function GET(request: Request) {
  const secret = env.worldTrackerCollectorSecret;
  if (secret) {
    const url = new URL(request.url);
    const provided = request.headers.get("x-collector-secret") ?? url.searchParams.get("secret");
    if (provided !== secret) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }
  }

  const result = await runCollectionCycle();
  return NextResponse.json(result);
}
