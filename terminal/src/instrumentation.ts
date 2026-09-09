// Starts the GDELT news collector's background poll loop once, when the
// Next.js server process starts — see node_modules/next/dist/docs's
// instrumentation.md ("register() is called once when a new Next.js server
// instance is initiated"). This is what makes the collector run 24/7 on any
// persistent host (npm run dev, next start on a VPS/Fly.io/Render, etc.)
// with zero extra setup. On stateless serverless hosting (Vercel's default),
// a setInterval here won't survive between invocations — deploy there and
// point an external free cron at /api/world-tracker/collect instead (see
// that route's comment and the README).
//
// Guarded by a globalThis flag (same singleton pattern as lib/db.ts's pool)
// so Next.js dev's hot-reload never double-registers the interval.

const POLL_INTERVAL_MS = Number(process.env.WORLD_TRACKER_POLL_INTERVAL_MS) || 5 * 60 * 1000;
// Checks in this often, but each check is a near-free no-op unless a scan
// is actually due — see zone-scan-cycle.ts's internal pacing (routine scans
// stay ~75 min apart to respect the free Gemini tier's 20/day cap; a GDELT-
// detected urgent signal can still trigger an out-of-cycle scan sooner).
// Same interval as the GDELT collector so "check every 5 minutes" is
// literally true even though most checks don't spend a Gemini call.
const ZONE_SCAN_CHECKIN_INTERVAL_MS = Number(process.env.WORLD_TRACKER_ZONE_SCAN_INTERVAL_MS) || 5 * 60 * 1000;

declare global {
  var __worldTrackerCollectorStarted: boolean | undefined;
  var __worldTrackerZoneScanStarted: boolean | undefined;
}

export async function register() {
  // Only the Node.js runtime has a persistent process to hold a setInterval —
  // the Edge runtime instance doesn't, and would just leak the timer per request.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  if (!globalThis.__worldTrackerCollectorStarted) {
    globalThis.__worldTrackerCollectorStarted = true;
    const { runCollectionCycle } = await import("@/lib/world-tracker/gdelt-provider");
    console.log(`[gdelt-collector] background poll starting, every ${POLL_INTERVAL_MS / 1000}s`);
    runCollectionCycle().catch((err) => console.error("[gdelt-collector] initial cycle failed:", err));
    setInterval(() => {
      runCollectionCycle().catch((err) => console.error("[gdelt-collector] cycle failed:", err));
    }, POLL_INTERVAL_MS);
  }

  if (!globalThis.__worldTrackerZoneScanStarted) {
    globalThis.__worldTrackerZoneScanStarted = true;
    const { runZoneScanCycle } = await import("@/lib/world-tracker/zone-scan-cycle");
    console.log(`[zone-scanner] background check-in starting, every ${ZONE_SCAN_CHECKIN_INTERVAL_MS / 1000}s`);
    runZoneScanCycle().catch((err) => console.error("[zone-scanner] initial scan failed:", err));
    setInterval(() => {
      runZoneScanCycle().catch((err) => console.error("[zone-scanner] scan failed:", err));
    }, ZONE_SCAN_CHECKIN_INTERVAL_MS);
  }
}
