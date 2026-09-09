import "server-only";
import { scanForRestrictedZones } from "@/lib/world-tracker/zone-scanner";
import {
  backdateZones,
  getAllZones,
  hasAnyZones,
  pruneStaleZones,
  slugify,
  upsertZones,
} from "@/lib/world-tracker/zones-store";
import { CONFLICT_ZONES } from "@/lib/world-tracker/conflict-zones";
import { MARITIME_RESTRICTIONS } from "@/lib/world-tracker/maritime-restrictions";

const LOG_PREFIX = "[zone-scanner]";

// Same 20-requests/day free-tier ceiling already confirmed on the other two
// Gemini keys applies here too — true 5-minute polling (288 calls/day)
// isn't achievable on a free key, so routine scans are paced to the safe
// maximum instead (~19/day). What actually makes new events show up fast is
// the urgent path below: instrumentation.ts still *checks in* every 5
// minutes (calling this function that often), but each check only spends
// an actual Gemini call when one of these gates is due.
const ROUTINE_SCAN_INTERVAL_MS = 75 * 60 * 1000;
// A GDELT-detected "new war/blockade"-looking headline (see gdelt-provider.ts)
// bypasses the routine gate and fires an out-of-cycle scan almost
// immediately, still throttled to this floor so a burst of similar
// headlines in one GDELT cycle can't fire several scans back to back.
const URGENT_SCAN_INTERVAL_MS = 10 * 60 * 1000;
let lastScanAttemptAt = 0;

/**
 * Seeds the table from the old hand-curated lists once, on the very first
 * scan cycle after the restricted_zones table exists — so the map isn't
 * blank on day one while waiting for the first AI scan (or if the scan
 * fails/the key isn't configured yet). After this, those static files are
 * no longer read anywhere else; the AI scan owns updating this data going
 * forward, including eventually aging these seed rows out if it stops
 * reconfirming them.
 */
async function seedIfEmpty(): Promise<void> {
  if (await hasAnyZones()) return;
  const seed = [
    ...CONFLICT_ZONES.map((z) => ({
      name: z.name,
      kind: "conflict" as const,
      latitude: z.latitude,
      longitude: z.longitude,
      radiusKm: z.radiusKm,
      severity: z.severity,
      summary: z.summary,
      sourceNote: null,
    })),
    ...MARITIME_RESTRICTIONS.map((z) => ({
      name: z.name,
      kind: "maritime" as const,
      latitude: z.latitude,
      longitude: z.longitude,
      radiusKm: z.radiusKm,
      severity: null,
      summary: z.summary,
      sourceNote: z.source,
    })),
  ];
  await upsertZones(seed);
  // Backdate so this one-time bootstrap doesn't falsely read as "just
  // discovered" under the map's new-zone highlight (see WorldMap.tsx's
  // ZONE_NEW_HIGHLIGHT_MS, a 24h window) — these are known pre-existing
  // situations, not something the AI just found.
  await backdateZones(seed.map((z) => slugify(z.name)), 25);
  console.log(`${LOG_PREFIX} seeded ${seed.length} zones from the old static lists`);
}

/**
 * One scan cycle: seed on first run, ask Gemini for currently-active
 * conflict zones and maritime blockades/restrictions, upsert whatever it
 * found, then prune zones that haven't been reconfirmed in a while. A
 * failed/empty scan just leaves the existing data in place rather than
 * clearing anything — see zone-scanner.ts's never-fabricate contract.
 *
 * Called every 5 minutes (see instrumentation.ts) but internally paced —
 * most calls are a no-op ("not due yet") rather than an actual Gemini
 * request, which is what keeps this within the free-tier daily cap. Pass
 * `urgent: true` for a GDELT-detected signal that's worth spending one of
 * the day's limited calls on right away rather than waiting for the next
 * routine slot (see ROUTINE_SCAN_INTERVAL_MS / URGENT_SCAN_INTERVAL_MS
 * above).
 */
export async function runZoneScanCycle(
  options: { urgent?: boolean; force?: boolean } = {},
): Promise<{ scanned: number | null; pruned: number; skipped: boolean }> {
  await seedIfEmpty();

  const minInterval = options.force ? 0 : options.urgent ? URGENT_SCAN_INTERVAL_MS : ROUTINE_SCAN_INTERVAL_MS;
  if (Date.now() - lastScanAttemptAt < minInterval) {
    return { scanned: null, pruned: 0, skipped: true };
  }
  lastScanAttemptAt = Date.now();

  const zones = await scanForRestrictedZones();
  if (zones !== null && zones.length > 0) {
    await upsertZones(zones);
  }
  const pruned = await pruneStaleZones();

  console.log(
    `${LOG_PREFIX} cycle done${options.urgent ? " (urgent)" : ""}: scanned=${zones?.length ?? "failed"} pruned=${pruned} total=${(await getAllZones()).length}`,
  );

  return { scanned: zones?.length ?? null, pruned, skipped: false };
}
