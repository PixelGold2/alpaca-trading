import "server-only";
import { classify } from "@/lib/world-tracker/classify";
import { resolveCountryCentroid } from "@/lib/world-tracker/country-centroids";
import { extractCountries } from "@/lib/world-tracker/geo-extract";
import { extractCountryFromText } from "@/lib/world-tracker/text-country-extract";
import { insertNewEvents, pruneOldEvents } from "@/lib/world-tracker/events-store";
import { notifyAllUsers } from "@/lib/notifications";

const LOG_PREFIX = "[gdelt-collector]";

// GDELT's HTTPS endpoint times out from this dev network (TLS/routing issue,
// not a GDELT outage — DNS resolves fine and plain HTTP to the same host
// works, confirmed live). Re-test HTTPS before assuming this applies to
// whatever host this eventually runs on.
const GDELT_BASE_URL = "http://api.gdeltproject.org/api/v2/doc/doc";

// GDELT asks for at least 5s between requests; this app waits longer to stay
// well clear of that, especially since shared/NAT'd IPs seem to get a
// stricter effective limit in practice than the stated one.
const REQUEST_SPACING_MS = 8_000;
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 5_000;
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_RECORDS_PER_QUERY = 50;
const TIMESPAN = "1h";

// The free Gemini tier caps gemini-3.6-flash at 20 requests/day, *total* —
// confirmed from Google's own 429 response
// (GenerateRequestsPerDayPerProjectPerModel-FreeTier, quotaValue "20"), not
// documented anywhere obvious beforehand. Calling it every 5-minute
// collection cycle burns through that in under 2 hours, after which every
// remaining cycle for the rest of the day silently falls back to GDELT's
// sourcecountry — the exact wrong-country pattern a user caught in practice
// (e.g. an Angola story landing on Nigeria, the pan-African outlet's
// registered country). 75 minutes keeps this to at most ~19 calls/day,
// leaving a little headroom under the cap. Tracked as module state (resets
// on process restart) rather than in the DB — this is a soft pacing guard,
// not data that needs to survive a restart.
const GEO_EXTRACT_MIN_INTERVAL_MS = 75 * 60 * 1000;
let lastGeoExtractAttemptAt = 0;

// Two broad OR-queries covering the full topic list from the spec, rather
// than one query per keyword — GDELT's rate limit makes a request per
// keyword impractical, and a handful of broad queries per cycle covers the
// same ground.
const QUERIES = [
  '(stocks OR equities OR "federal reserve" OR "interest rate" OR inflation OR CPI OR "central bank" OR bonds OR "treasury yield" OR earnings OR merger OR acquisition OR IPO OR "stock market") sourcelang:english',
  '(election OR government OR president OR sanctions OR tariffs OR war OR military OR diplomatic OR treaty OR legislation OR regulation) sourcelang:english',
];

interface GdeltArticle {
  url: string;
  title: string;
  seendate: string; // "20260823T174500Z"
  domain: string;
  sourcecountry: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseGdeltDate(seendate: string): string | null {
  // "20260823T174500Z" -> "2026-08-23T17:45:00Z"
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(seendate);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const iso = `${y}-${mo}-${d}T${h}:${mi}:${s}Z`;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? null : iso;
}

/**
 * One GDELT request, with retry/backoff on network failure or GDELT's
 * rate-limit response — which comes back as a 200 OK with a plain-text body,
 * not a 429, so it has to be detected by trying to parse JSON rather than by
 * status code.
 */
async function fetchGdeltQuery(query: string, attempt = 1): Promise<GdeltArticle[]> {
  const params = new URLSearchParams({
    query,
    mode: "artlist",
    format: "json",
    maxrecords: String(MAX_RECORDS_PER_QUERY),
    sort: "datedesc",
    timespan: TIMESPAN,
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${GDELT_BASE_URL}?${params}`, { signal: controller.signal });
    const text = await res.text();

    if (!res.ok) {
      throw new Error(`GDELT request failed (HTTP ${res.status}).`);
    }

    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      // Rate-limited or otherwise non-JSON response — GDELT sends these as
      // plain text inside a 200, e.g. "Please limit requests to one every 5
      // seconds...". Treat as retryable, not a hard failure.
      throw new Error(`GDELT returned a non-JSON response (likely rate-limited): ${text.slice(0, 120)}`);
    }

    const articles = (body as { articles?: unknown }).articles;
    return Array.isArray(articles) ? (articles as GdeltArticle[]) : [];
  } catch (err) {
    if (attempt >= MAX_RETRIES) {
      console.error(`${LOG_PREFIX} query failed after ${attempt} attempts:`, err instanceof Error ? err.message : err);
      return [];
    }
    const delay = RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
    console.warn(
      `${LOG_PREFIX} attempt ${attempt} failed (${err instanceof Error ? err.message : err}), retrying in ${delay}ms`,
    );
    await sleep(delay);
    return fetchGdeltQuery(query, attempt + 1);
  } finally {
    clearTimeout(timeout);
  }
}

interface PendingEvent {
  article: GdeltArticle;
  publishedAt: string;
  classification: NonNullable<ReturnType<typeof classify>>;
  fallbackLocation: ReturnType<typeof resolveCountryCentroid>;
}

type ExtractedCountryList = Awaited<ReturnType<typeof extractCountries>>;

/**
 * Three-tier geocoding, most-trustworthy signal first. Sourcecountry (the
 * publisher's registered country) is a weaker signal than it looks — for
 * wire services, syndication platforms, and pan-regional outlets it's
 * frequently just "wherever the domain happens to be registered," unrelated
 * to the story (a Pakistani outlet covering an Iran sanctions story still
 * reports sourcecountry "Pakistan"). Both stronger signals below exist to
 * avoid falling all the way through to it whenever possible:
 *
 * 1. Gemini's per-headline answer, when this cycle actually made the call
 *    (quota-limited, see GEO_EXTRACT_MIN_INTERVAL_MS) and it covered this
 *    headline. An explicit null here means Gemini read the real headline and
 *    declined — trusted as "skip," not treated as "no answer, fall through."
 * 2. A deterministic single-country match against the headline's own text
 *    (see text-country-extract.ts) — free, runs on every headline every
 *    cycle, unlike Gemini. Only fires when exactly one country is named or
 *    implied; a headline naming two-plus countries falls through rather than
 *    guessing which one is primary.
 * 3. sourcecountry, as the last resort when neither of the above resolved.
 */
function resolveLocation(
  title: string,
  extracted: ExtractedCountryList,
  extractedByIndex: Map<number, string | null>,
  index: number,
  fallbackLocation: ReturnType<typeof resolveCountryCentroid>,
): ReturnType<typeof resolveCountryCentroid> {
  if (extracted !== null && extractedByIndex.has(index)) {
    const country = extractedByIndex.get(index) ?? null;
    if (country === null) return null;
    const resolved = resolveCountryCentroid(country);
    if (resolved) return resolved;
  }

  const textCountry = extractCountryFromText(title);
  if (textCountry) {
    const resolved = resolveCountryCentroid(textCountry);
    if (resolved) return resolved;
  }

  return fallbackLocation;
}

/**
 * One full collection cycle: fetch every query (spaced out to respect
 * GDELT's rate limit), classify + dedupe in-memory, then geocode in two
 * layers — Gemini's headline-derived country (see geo-extract.ts) when it's
 * configured and resolves to a known centroid, falling back to GDELT's own
 * sourcecountry (the publisher's country, not necessarily the story's
 * subject) otherwise. Insert new rows (DB-level dedup handles overlap with
 * previous cycles), prune old rows. Never throws — a failed cycle just means
 * this tick found nothing new, and the next scheduled tick tries again (see
 * instrumentation.ts).
 */
export async function runCollectionCycle(): Promise<{ fetched: number; classified: number; inserted: number }> {
  const seenUrls = new Set<string>();
  const pending: PendingEvent[] = [];
  let fetched = 0;

  for (let i = 0; i < QUERIES.length; i++) {
    if (i > 0) await sleep(REQUEST_SPACING_MS);

    const articles = await fetchGdeltQuery(QUERIES[i]);
    fetched += articles.length;

    for (const article of articles) {
      if (!article.url || seenUrls.has(article.url)) continue;
      seenUrls.add(article.url);

      const publishedAt = parseGdeltDate(article.seendate);
      if (!publishedAt) continue;

      const classification = classify(article.title);
      if (!classification) continue; // doesn't clear any topic bucket — filtered out

      // Not skipped here even if this resolves to null — Gemini's extracted
      // country (below) might still resolve one where sourcecountry can't.
      const fallbackLocation = resolveCountryCentroid(article.sourcecountry);
      pending.push({ article, publishedAt, classification, fallbackLocation });
    }
  }

  // Gated by GEO_EXTRACT_MIN_INTERVAL_MS regardless of outcome (attempted,
  // not succeeded) — a 429 response still counts as "just tried," so a
  // string of failures can't retry every cycle and make the quota problem
  // worse. Skipping here behaves exactly like extractCountries returning
  // null: resolveLocation falls back to sourcecountry, same as before this
  // pacing existed.
  const dueForGeoExtract = Date.now() - lastGeoExtractAttemptAt >= GEO_EXTRACT_MIN_INTERVAL_MS;
  if (dueForGeoExtract) lastGeoExtractAttemptAt = Date.now();
  const extracted = dueForGeoExtract ? await extractCountries(pending.map((p) => p.article.title)) : null;
  // Keyed by each row's own `index` field, not its position in the array —
  // extractCountries/parseExtractions drops malformed/out-of-range rows, so
  // position and headline index silently diverge as soon as the model skips
  // or garbles even one entry. Indexing by position was a real bug: it could
  // attribute one headline's country to a completely different headline.
  const extractedByIndex = new Map(extracted?.map((e) => [e.index, e.country]) ?? []);

  const candidateRows: Parameters<typeof insertNewEvents>[0] = [];
  pending.forEach((p, i) => {
    const location = resolveLocation(p.article.title, extracted, extractedByIndex, i, p.fallbackLocation);
    if (!location) return; // no reliable centroid from any source — skipped, not guessed

    candidateRows.push({
      url: p.article.url,
      title: p.article.title,
      description: p.article.title, // GDELT's free artlist mode has no summary/body field
      category: p.classification.category,
      subcategory: p.article.domain,
      source: p.article.domain,
      publishedAt: p.publishedAt,
      country: location.country,
      latitude: location.latitude,
      longitude: location.longitude,
      locationPrecision: "country",
      importance: p.classification.importance,
      importanceScore: p.classification.importanceScore,
      tags: p.classification.tags,
    });
  });

  const { count: inserted, newUrls } = await insertNewEvents(candidateRows);
  const pruned = await pruneOldEvents();

  // A critical/breaking geopolitics headline this cycle (e.g. "a new war
  // has started somewhere") is worth spending one of the zone-scanner's
  // limited daily Gemini calls on right away, instead of waiting for its
  // next routine ~75-min slot — see zone-scan-cycle.ts's urgent path, which
  // has its own short cooldown so a burst of similar headlines in one
  // GDELT cycle can't fire more than one scan. Fire-and-forget: this cycle
  // shouldn't block on it, and a failed/skipped urgent scan just falls
  // back to the routine cadence.
  const hasUrgentSignal = candidateRows.some(
    (row) => row.category === "geopolitics" && (row.importance === "critical" || row.tags.includes("breaking")),
  );
  if (hasUrgentSignal) {
    import("@/lib/world-tracker/zone-scan-cycle")
      .then(({ runZoneScanCycle }) => runZoneScanCycle({ urgent: true }))
      .catch((err) => console.error(`${LOG_PREFIX} urgent zone-scan trigger failed:`, err));
  }

  // Surface critical stories in the notification center as they land on
  // the live feed. Gated on newUrls (genuinely new this cycle), not just
  // "importance === critical" — GDELT's 1h timespan means the same headline
  // can reappear in candidateRows for several cycles running, and without
  // this every user would get the same notification repeated every 5
  // minutes for up to an hour.
  const newCriticalRows = candidateRows.filter((row) => row.importance === "critical" && newUrls.has(row.url));
  for (const row of newCriticalRows) {
    const title = row.title.length > 140 ? `${row.title.slice(0, 137)}...` : row.title;
    notifyAllUsers({
      type: "critical_news",
      title,
      body: `${row.country} · ${row.category}`,
      link: "/world-tracker",
    }).catch((err) => console.error(`${LOG_PREFIX} critical-news notification failed:`, err));
  }

  console.log(
    `${LOG_PREFIX} cycle done: fetched=${fetched} classified=${candidateRows.length} inserted=${inserted} pruned=${pruned} criticalNotified=${newCriticalRows.length}`,
  );

  return { fetched, classified: candidateRows.length, inserted };
}
