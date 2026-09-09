import "server-only";
import { env } from "@/lib/env";

const PROVIDER_NAME = "gemini-zone-scanner";
const MODEL = "gemini-3.6-flash";
// Grounded (Google Search) requests do a real search-and-synthesize round
// trip on top of the model's usual generation time, which is already slow
// for this model (see geo-extract.ts's own 45s timeout) — give this even
// more room since it's a once-a-day background scan with nothing waiting on
// it synchronously.
const REQUEST_TIMEOUT_MS = 60_000;

export interface ScannedZone {
  name: string;
  kind: "conflict" | "maritime";
  latitude: number;
  longitude: number;
  radiusKm: number;
  severity: "critical" | "high" | "medium" | null;
  summary: string;
  sourceNote: string | null;
}

const PROMPT = `Identify CURRENTLY ACTIVE examples of:
1. Major armed conflict zones worldwide (wars, civil wars, large-scale insurgencies).
2. Maritime blockades or officially restricted/high-risk shipping waters — naval blockades,
   piracy high-risk areas, war-risk zones as designated by bodies like UKMTO/JMIC, or similar
   national/international maritime security advisories.

If you have live search results available for this request, use them and prefer the most recent
information you find. If you do NOT have live search access right now, rely only on
long-running, widely-reported situations you are highly confident are still ongoing — never
guess at something that could plausibly have resolved, escalated, or changed since your training.

In either case: never invent a location, never fabricate a specific date/casualty figure/official
statement, and never include an entry you are not reasonably confident about. It is always better
to return fewer, correct entries than to include a wrong or stale one — omit anything you're
unsure of entirely rather than guessing.

Return ONLY a JSON array, no markdown code fences, no commentary before or after, shaped exactly
as:
[{
  "name": "<short place name>",
  "kind": "conflict" | "maritime",
  "latitude": <number>,
  "longitude": <number>,
  "radiusKm": <number>,
  "severity": "critical" | "high" | "medium" | null,
  "summary": "<one or two sentences: what is happening and why>",
  "sourceNote": "<the organization/outlet this comes from, e.g. 'UKMTO/JMIC advisory' or 'Reuters' — null if you're not confident of a specific source>"
}]

"severity" is your own assessment of how serious/dangerous the zone currently is; use null only
if you genuinely can't judge it. Use full English place names, not codes.`;

function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenced ? fenced[1] : trimmed;
}

function parseZones(text: string): ScannedZone[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFence(text));
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;

  const result: ScannedZone[] = [];
  for (const row of parsed) {
    const r = row as Record<string, unknown>;
    if (typeof r.name !== "string" || !r.name.trim()) continue;
    if (r.kind !== "conflict" && r.kind !== "maritime") continue;
    if (typeof r.latitude !== "number" || typeof r.longitude !== "number") continue;
    if (Math.abs(r.latitude) > 90 || Math.abs(r.longitude) > 180) continue;
    if (typeof r.radiusKm !== "number" || r.radiusKm <= 0) continue;
    if (typeof r.summary !== "string" || !r.summary.trim()) continue;
    const severity =
      r.severity === "critical" || r.severity === "high" || r.severity === "medium" ? r.severity : null;
    const sourceNote = typeof r.sourceNote === "string" && r.sourceNote.trim() ? r.sourceNote.trim() : null;

    result.push({
      name: r.name.trim(),
      kind: r.kind,
      latitude: r.latitude,
      longitude: r.longitude,
      radiusKm: r.radiusKm,
      severity,
      summary: r.summary.trim(),
      sourceNote,
    });
  }
  return result;
}

async function callGemini(useGrounding: boolean): Promise<Response> {
  const body: Record<string, unknown> = { contents: [{ parts: [{ text: PROMPT }] }] };
  if (useGrounding) body.tools = [{ google_search: {} }];

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${env.worldTrackerZoneGeminiApiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Replaces the old hand-maintained CONFLICT_ZONES/MARITIME_RESTRICTIONS
 * static lists with a Gemini scan. Uses its own dedicated
 * WORLD_TRACKER_ZONE_GEMINI_API_KEY, separate from both other Gemini keys
 * in this app, so its usage never competes with the Research Assistant or
 * GDELT geocoding.
 *
 * Tries Google Search grounding first (so answers reflect real current
 * events, not just training data — genuinely important for "is this strait
 * currently blockaded"), but Search grounding turned out to need quota this
 * account doesn't have — confirmed empirically, every key tried 429s
 * immediately on the `google_search` tool even though plain calls succeed.
 * A grounding-specific 429 retries once without the tool rather than
 * failing the whole scan, so the feature still works — just from the
 * model's training knowledge, with the prompt's anti-fabrication rules
 * doing more of the work in that mode. If grounding quota ever opens up
 * (monthly reset, billing enabled on the project, etc.) this starts using
 * it automatically without any code change.
 *
 * Returns null on any failure (missing key, network error, bad response,
 * unparseable output) — the caller (zone-scan-cycle.ts) just skips this
 * cycle and tries again next time, same never-fabricate contract as every
 * other provider here.
 */
export async function scanForRestrictedZones(): Promise<ScannedZone[] | null> {
  if (!env.worldTrackerZoneGeminiApiKey) return null;

  try {
    let res: Response;
    try {
      res = await callGemini(true);
      if (res.status === 429) {
        console.warn(`[${PROVIDER_NAME}] Search grounding unavailable (429), retrying without it`);
        res = await callGemini(false);
      }
    } catch (fetchErr) {
      const name = fetchErr instanceof Error ? fetchErr.name : "UnknownError";
      const cause = fetchErr instanceof Error && fetchErr.cause ? String(fetchErr.cause) : "";
      throw new Error(`Network error contacting Gemini (${name}${cause ? `: ${cause}` : ""}).`);
    }

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Gemini request failed (HTTP ${res.status}): ${body.slice(0, 200)}`);
    }

    const json = await res.json();
    const text = json?.candidates?.[0]?.content?.parts?.find((p: { text?: string }) => p.text)?.text;
    if (!text) throw new Error("Gemini returned no text content.");

    return parseZones(text);
  } catch (err) {
    console.warn(`[${PROVIDER_NAME}] scan failed, keeping existing zones:`, err instanceof Error ? err.message : err);
    return null;
  }
}
