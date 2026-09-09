import { COUNTRY_NAME_CENTROIDS } from "@/lib/world-tracker/country-centroids";

/**
 * Deterministic, zero-cost first pass at "which country is this headline
 * actually about" — reads the headline text itself rather than trusting
 * GDELT's `sourcecountry` (the publisher's registered country, which is
 * frequently unrelated to the story: a Pakistani outlet covering an Iran
 * sanctions story still reports sourcecountry "Pakistan"). Runs on every
 * headline in every collection cycle since it costs nothing, unlike the
 * Gemini refinement in geo-extract.ts which is quota-limited to ~19
 * calls/day — see gdelt-provider.ts for how the two combine.
 *
 * Deliberately conservative: only returns a country when exactly ONE is
 * named or clearly implied by the text. A headline naming two-plus
 * countries (a genuinely ambiguous "who is this story about" case, e.g.
 * "US and Canada trade war") returns null rather than guessing which one
 * is primary — that judgment call is left to Gemini when it's available,
 * or sourcecountry as the last resort.
 */

// Common demonyms/adjectives/abbreviations for countries that show up
// often in wire-service headlines but rarely appear by their exact
// COUNTRY_NAME_CENTROIDS key (e.g. "Iranian sanctions", not "Iran
// sanctions"). Not exhaustive — countries not listed here still match via
// their exact name in COUNTRY_NAME_CENTROIDS, just not via an adjective
// form. Extend as real misses turn up rather than front-loading all ~180.
const DEMONYM_ALIASES: Record<string, string> = {
  american: "United States",
  americans: "United States",
  "u.s.": "United States",
  usa: "United States",
  british: "United Kingdom",
  britain: "United Kingdom",
  uk: "United Kingdom",
  iranian: "Iran",
  iranians: "Iran",
  iraqi: "Iraq",
  israeli: "Israel",
  israelis: "Israel",
  palestinian: "Palestine",
  palestinians: "Palestine",
  russian: "Russia",
  russians: "Russia",
  ukrainian: "Ukraine",
  ukrainians: "Ukraine",
  chinese: "China",
  japanese: "Japan",
  korean: "South Korea",
  "south korean": "South Korea",
  "north korean": "North Korea",
  indian: "India",
  pakistani: "Pakistan",
  pakistanis: "Pakistan",
  canadian: "Canada",
  canadians: "Canada",
  mexican: "Mexico",
  brazilian: "Brazil",
  german: "Germany",
  french: "France",
  italian: "Italy",
  spanish: "Spain",
  turkish: "Turkey",
  saudi: "Saudi Arabia",
  emirati: "United Arab Emirates",
  uae: "United Arab Emirates",
  qatari: "Qatar",
  egyptian: "Egypt",
  syrian: "Syria",
  lebanese: "Lebanon",
  yemeni: "Yemen",
  afghan: "Afghanistan",
  australian: "Australia",
  nigerian: "Nigeria",
  kenyan: "Kenya",
  polish: "Poland",
};

// "US" is the single most common way headlines reference the United States
// ("US Warns Iran Sanctions") — too useful to skip — but matched
// case-insensitively it collides with the ordinary pronoun "us" ("China
// warns us of..."). Matched case-SENSITIVELY (bare "US", not "us") instead
// of folding into DEMONYM_ALIASES, which is intentionally
// case-insensitive for everything else.
const CASE_SENSITIVE_ALIASES: Record<string, string> = {
  US: "United States",
};

interface CountryPattern {
  country: string;
  regex: RegExp;
}

let patternsCache: CountryPattern[] | null = null;

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Lookaround boundaries instead of `\b` — `\b` requires a transition between
// a word char and a non-word char, which silently never matches for a term
// ending in punctuation like "U.S." (its last "." and the following space
// are both non-word chars, so no boundary exists between them and `\b`
// fails there). Lookarounds just check "not a word char on the other side,"
// which works uniformly for plain words and punctuation-ending aliases.
function boundaryPattern(term: string): string {
  return `(?<![A-Za-z0-9_])${escapeRegex(term)}(?![A-Za-z0-9_])`;
}

function buildPatterns(): CountryPattern[] {
  const patterns: CountryPattern[] = [];
  for (const name of Object.keys(COUNTRY_NAME_CENTROIDS)) {
    patterns.push({ country: name, regex: new RegExp(boundaryPattern(name), "i") });
  }
  for (const [alias, country] of Object.entries(DEMONYM_ALIASES)) {
    patterns.push({ country, regex: new RegExp(boundaryPattern(alias), "i") });
  }
  for (const [alias, country] of Object.entries(CASE_SENSITIVE_ALIASES)) {
    patterns.push({ country, regex: new RegExp(boundaryPattern(alias)) });
  }
  return patterns;
}

function getPatterns(): CountryPattern[] {
  if (!patternsCache) patternsCache = buildPatterns();
  return patternsCache;
}

/**
 * Returns the single country a headline's text names or implies, or null
 * when zero or multiple distinct countries are matched. Never guesses
 * between candidates.
 */
export function extractCountryFromText(title: string): string | null {
  const matched = new Set<string>();
  for (const { country, regex } of getPatterns()) {
    if (regex.test(title)) matched.add(country);
  }
  if (matched.size !== 1) return null;
  return [...matched][0];
}
