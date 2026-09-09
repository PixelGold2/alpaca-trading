"use client";

import { usePreferences } from "@/lib/preferences/PreferencesProvider";

function SunIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
      <path d="M20.4 14.7A8.5 8.5 0 1 1 9.3 3.6a7 7 0 0 0 11.1 11.1Z" />
    </svg>
  );
}

function TickerIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="2" y="7" width="20" height="10" rx="2" />
      <path d="M6 12h4M13 10l1.5 4L16 11l1 2" />
    </svg>
  );
}

export function PreferenceToggles() {
  const { theme, setTheme, tickerVisible, setTickerVisible } = usePreferences();

  return (
    <div className="flex items-center gap-1 border-l border-border pl-3">
      <button
        onClick={() => setTickerVisible(!tickerVisible)}
        title={tickerVisible ? "Hide market ticker" : "Show market ticker"}
        className={`flex items-center gap-1 rounded px-1.5 py-1 text-[10px] transition ${
          tickerVisible ? "bg-accent/15 text-accent-strong" : "text-text-muted hover:bg-bg-hover"
        }`}
      >
        <TickerIcon />
      </button>
      <button
        onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
        className="flex items-center gap-1 rounded px-1.5 py-1 text-[10px] text-text-secondary transition hover:bg-bg-hover"
      >
        {theme === "dark" ? <MoonIcon /> : <SunIcon />}
      </button>
    </div>
  );
}
