"use client";

import { usePreferences } from "@/lib/preferences/PreferencesProvider";
import { CategoryTicker } from "@/components/terminal/CategoryTicker";

/** Renders the shared category ticker on every route, unless toggled off in TopBar. */
export function GlobalTicker() {
  const { tickerVisible } = usePreferences();
  if (!tickerVisible) return null;
  return <CategoryTicker />;
}
