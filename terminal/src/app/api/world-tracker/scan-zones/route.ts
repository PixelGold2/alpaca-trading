import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { runZoneScanCycle } from "@/lib/world-tracker/zone-scan-cycle";

/**
 * Runs one conflict-zone/maritime-restriction AI scan check-in on demand —
 * same trigger-point role as /api/world-tracker/collect, for hosting where
 * the in-process instrumentation.ts interval isn't reliable (stateless
 * serverless); point a cron at this every 5 minutes to match what
 * instrumentation.ts already does. Shares the same secret as
 * /api/world-tracker/collect rather than adding a second env var for what's
 * functionally the same kind of endpoint. Most calls are a no-op — see
 * zone-scan-cycle.ts's internal pacing — pass `?force=true` to bypass that
 * and actually scan regardless of timing (useful for testing).
 */
export async function GET(request: Request) {
  const secret = env.worldTrackerCollectorSecret;
  const url = new URL(request.url);
  if (secret) {
    const provided = request.headers.get("x-collector-secret") ?? url.searchParams.get("secret");
    if (provided !== secret) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }
  }

  const force = url.searchParams.get("force") === "true";
  const result = await runZoneScanCycle({ force });
  return NextResponse.json(result);
}
