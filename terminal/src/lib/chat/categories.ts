export const CHAT_CATEGORIES = ["general", "markets", "forex", "crypto", "futures", "commodities"] as const;
export type ChatCategory = (typeof CHAT_CATEGORIES)[number];

export const CHAT_CATEGORY_LABELS: Record<ChatCategory, string> = {
  general: "General",
  markets: "Markets",
  forex: "Forex",
  crypto: "Crypto",
  futures: "Futures",
  commodities: "Commodities",
};
