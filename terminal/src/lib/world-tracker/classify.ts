import type { EventCategory, EventImportance, FeedTag } from "@/lib/world-tracker/types";

/**
 * Keyword-based classification — no AI model, $0 marginal cost per article.
 * GDELT's free DOC API doesn't return themes/entities in artlist mode (that
 * needs the paid GKG stack), so this works off title text only. Deliberately
 * conservative: an article that doesn't clear FINANCE_KEYWORDS,
 * POLITICS_KEYWORDS, or GEOPOLITICS_KEYWORDS is dropped entirely by the
 * caller — this is the "aggressively filter out irrelevant general news"
 * mechanism, not a cosmetic label.
 */

const FINANCE_KEYWORDS = [
  "stock",
  "stocks",
  "equity",
  "equities",
  "shares",
  "federal reserve",
  "fed",
  "fed rate",
  "fed chair",
  "interest rate",
  "rate hike",
  "rate cut",
  "inflation",
  "cpi",
  "consumer price",
  "employment",
  "unemployment",
  "jobs report",
  "payroll",
  "nonfarm",
  "central bank",
  "ecb",
  "boe",
  "boj",
  "pboc",
  "bond",
  "bonds",
  "treasury yield",
  "treasury yields",
  "10-year yield",
  "currency",
  "currencies",
  "forex",
  "exchange rate",
  "oil price",
  "crude oil",
  "opec",
  "gold price",
  "commodity",
  "commodities",
  "crypto",
  "bitcoin",
  "ethereum",
  "earnings",
  "quarterly results",
  "merger",
  "acquisition",
  "buyout",
  "ipo",
  "buyback",
  "dividend",
  "wall street",
  "nasdaq",
  "dow jones",
  "s&p 500",
  "stock market",
  "market rally",
  "market selloff",
  "market crash",
  "recession",
  "gdp growth",
  "trade deficit",
  "tariff",
];

const POLITICS_KEYWORDS = [
  "election",
  "elections",
  "president",
  "prime minister",
  "government",
  "senate",
  "congress",
  "parliament",
  "legislation",
  "regulation",
  "bill passed",
  "vote",
  "voters",
  "campaign",
  "cabinet",
  "governor",
  "referendum",
  "impeachment",
  "policy announcement",
];

const GEOPOLITICS_KEYWORDS = [
  "sanction",
  "sanctions",
  "tariffs",
  "trade war",
  "war",
  "military",
  "troops",
  "missile",
  "airstrike",
  "invasion",
  "ceasefire",
  "conflict",
  "diplomat",
  "diplomatic",
  "treaty",
  "nato",
  "united nations",
  "border dispute",
  "peace talks",
  "hostage",
  "coup",
  "insurgency",
];

const BREAKING_KEYWORDS = ["breaking", "urgent", "just in", "developing"];
const CENTRAL_BANK_KEYWORDS = ["federal reserve", "fed", "ecb", "boe", "boj", "central bank", "rate decision"];
const CRYPTO_KEYWORDS = ["crypto", "bitcoin", "ethereum"];
const EARNINGS_KEYWORDS = ["earnings", "quarterly results"];
const ENERGY_KEYWORDS = ["oil price", "crude oil", "opec", "natural gas", "energy crisis"];
const DEFENSE_KEYWORDS = ["military", "missile", "airstrike", "invasion", "troops", "nato"];

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Word-boundary matching, not substring — plain .includes() false-positives
// constantly (e.g. "war" inside "warns", "aid" inside "said"), which
// undermines the "aggressively filter irrelevant news" goal more than it
// helps. Cached per keyword since the same keyword lists run against every
// title in every collection cycle.
const keywordRegexCache = new Map<string, RegExp>();
function keywordRegex(keyword: string): RegExp {
  let re = keywordRegexCache.get(keyword);
  if (!re) {
    re = new RegExp(`\\b${escapeRegex(keyword)}\\b`, "i");
    keywordRegexCache.set(keyword, re);
  }
  return re;
}

function countHits(haystack: string, keywords: string[]): number {
  return keywords.reduce((n, kw) => (keywordRegex(kw).test(haystack) ? n + 1 : n), 0);
}

export interface Classification {
  category: EventCategory;
  importanceScore: number; // 1-10, raw
  importance: EventImportance; // bucketed, matches the existing UI's 4-value scale
  tags: FeedTag[];
}

// Entertainment/trivia titles occasionally clear a topic keyword on a real
// word (e.g. an anime called "... Blood War", a game studio "campaign" mode)
// — word-boundary matching alone can't tell "war" the noun from War the show.
// A hard exclude list on unambiguous entertainment/celebrity signal words
// catches most of these without needing real NLP.
const EXCLUDE_KEYWORDS = [
  "anime",
  "episode",
  "imdb",
  "netflix",
  "season finale",
  "box office",
  "celebrity",
  "kardashian",
  "video game",
  "album review",
  "tv series",
];

/** Returns null when the title doesn't clear any topic bucket — caller drops the article. */
export function classify(title: string): Classification | null {
  const text = title; // keywordRegex() matches case-insensitively with word boundaries

  if (countHits(text, EXCLUDE_KEYWORDS) > 0) return null;

  const financeHits = countHits(text, FINANCE_KEYWORDS);
  const politicsHits = countHits(text, POLITICS_KEYWORDS);
  const geoHits = countHits(text, GEOPOLITICS_KEYWORDS);

  if (financeHits === 0 && politicsHits === 0 && geoHits === 0) return null;

  // Priority order for the primary label when a title spans categories (e.g.
  // "Sanctions hit Russian oil exports, crude prices jump" hits both finance
  // and geopolitics) — finance first since this app is a trading terminal,
  // geopolitics before plain politics since it's the more specific bucket.
  let category: EventCategory;
  if (financeHits >= geoHits && financeHits >= politicsHits) category = "finance";
  else if (geoHits >= politicsHits) category = "geopolitics";
  else category = "politics";

  // Importance: base + weighted signal keywords + breadth bonus. A heuristic,
  // not a model — deliberately conservative so most stories land low/medium
  // and only genuinely major-sounding ones reach high/critical.
  let score = 2;
  if (countHits(text, CENTRAL_BANK_KEYWORDS) > 0) score += 3;
  if (countHits(text, DEFENSE_KEYWORDS) > 0) score += 3;
  if (geoHits > 0) score += 1;
  if (keywordRegex("sanctions").test(text)) score += 2;
  if (keywordRegex("election").test(text)) score += 2;
  if (countHits(text, EARNINGS_KEYWORDS) > 0) score += 1;
  if (countHits(text, BREAKING_KEYWORDS) > 0) score += 2;
  const totalHits = financeHits + politicsHits + geoHits;
  if (totalHits >= 3) score += 1;
  score = Math.max(1, Math.min(10, score));

  const importance: EventImportance = score >= 8 ? "critical" : score >= 7 ? "high" : score >= 4 ? "medium" : "low";

  const tags: FeedTag[] = [];
  if (countHits(text, BREAKING_KEYWORDS) > 0) tags.push("breaking");
  if (countHits(text, CENTRAL_BANK_KEYWORDS) > 0) tags.push("central_banks");
  if (countHits(text, CRYPTO_KEYWORDS) > 0) tags.push("crypto");
  // Gated on category, not just the keyword hit — "earnings"/"quarterly
  // results" can appear in a story whose *dominant* signal is actually
  // politics/geopolitics (e.g. more war/sanctions keyword hits than finance
  // ones), which used to still tag it "earnings" despite category never
  // being finance. That let unrelated Politics/Geopolitics stories surface
  // when filtering the feed to Earnings — a real user-visible bug, not just
  // a labeling nitpick.
  if (category === "finance" && countHits(text, EARNINGS_KEYWORDS) > 0) tags.push("earnings");
  if (countHits(text, ENERGY_KEYWORDS) > 0) tags.push("energy");
  if (category === "finance") tags.push("markets");

  return { category, importanceScore: score, importance, tags };
}
