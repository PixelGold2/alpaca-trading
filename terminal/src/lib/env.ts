import "server-only";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  get databaseUrl() {
    return required("DATABASE_URL");
  },
  get sessionCookieName() {
    return process.env.SESSION_COOKIE_NAME || "terminal_session";
  },
  get nodeEnv() {
    return process.env.NODE_ENV || "development";
  },
  get isProduction() {
    return process.env.NODE_ENV === "production";
  },
  // Optional: absence must degrade features gracefully, never crash the app.
  get alpacaKeyId() {
    return process.env.ALPACA_API_KEY_ID;
  },
  get alpacaSecretKey() {
    return process.env.ALPACA_API_SECRET_KEY;
  },
  get alpacaBaseUrl() {
    return process.env.ALPACA_API_BASE_URL || "https://paper-api.alpaca.markets";
  },
  get fmpApiKey() {
    return process.env.FMP_API_KEY;
  },
  get geminiApiKey() {
    return process.env.GEMINI_API_KEY;
  },
  get finnhubApiKey() {
    return process.env.FINNHUB_API_KEY;
  },
  get aisstreamApiKey() {
    return process.env.AISSTREAM_API_KEY;
  },
  get fredApiKey() {
    return process.env.FRED_API_KEY;
  },
  // Shared secret an external cron pinger presents to trigger a World
  // Tracker/GDELT collection cycle on demand (see
  // /api/world-tracker/collect). Optional — if unset, the endpoint is open,
  // which is fine for local dev but should always be set for any public
  // deployment.
  get worldTrackerCollectorSecret() {
    return process.env.WORLD_TRACKER_COLLECTOR_SECRET;
  },
  // Separate from geminiApiKey — see .env.example. Refines GDELT stories'
  // country from headline text; leaving it unset just skips that refinement.
  get worldTrackerGeminiApiKey() {
    return process.env.WORLD_TRACKER_GEMINI_API_KEY;
  },
  // A third, dedicated Gemini key — used only by the conflict-zone/maritime-
  // restriction scanner (zone-scanner.ts), kept separate from the other two
  // so its usage/quota never competes with the Research Assistant or the
  // GDELT geocoding refinement. See .env.example.
  get worldTrackerZoneGeminiApiKey() {
    return process.env.WORLD_TRACKER_ZONE_GEMINI_API_KEY;
  },
};
