"use client";

import { createContext, useContext, useEffect, useState } from "react";

export type Theme = "dark" | "light";

interface Preferences {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  tickerVisible: boolean;
  setTickerVisible: (visible: boolean) => void;
}

const THEME_KEY = "terminal_theme";
const TICKER_KEY = "terminal_ticker_visible";

const PreferencesContext = createContext<Preferences | null>(null);

export function PreferencesProvider({ children }: { children: React.ReactNode }) {
  // Initial values mirror the no-flash inline script in app/layout.tsx (same
  // localStorage keys, same "dark"/true defaults) so the first client render
  // matches what's already on screen instead of causing a visible flip.
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof window === "undefined") return "dark";
    return (localStorage.getItem(THEME_KEY) as Theme | null) ?? "dark";
  });
  const [tickerVisible, setTickerVisibleState] = useState(() => {
    if (typeof window === "undefined") return true;
    return localStorage.getItem(TICKER_KEY) !== "false";
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem(TICKER_KEY, String(tickerVisible));
  }, [tickerVisible]);

  return (
    <PreferencesContext.Provider
      value={{ theme, setTheme: setThemeState, tickerVisible, setTickerVisible: setTickerVisibleState }}
    >
      {children}
    </PreferencesContext.Provider>
  );
}

export function usePreferences(): Preferences {
  const ctx = useContext(PreferencesContext);
  if (!ctx) throw new Error("usePreferences must be used within PreferencesProvider");
  return ctx;
}
