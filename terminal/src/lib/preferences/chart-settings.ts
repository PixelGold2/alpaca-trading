export interface ChartSettings {
  upColor: string;
  downColor: string;
  background: string;
  gridColor: string;
  gridVisible: boolean;
  crosshairMode: "normal" | "magnet" | "hidden";
}

export const DEFAULT_CHART_SETTINGS: ChartSettings = {
  upColor: "#16c784",
  downColor: "#ef4444",
  background: "#10141b",
  gridColor: "#232a37",
  gridVisible: true,
  crosshairMode: "magnet",
};

const STORAGE_KEY = "terminal_chart_settings";

/** Same lazy-read/write-back-on-change localStorage convention as PreferencesProvider's theme setting. */
export function loadChartSettings(): ChartSettings {
  if (typeof window === "undefined") return DEFAULT_CHART_SETTINGS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_CHART_SETTINGS;
    return { ...DEFAULT_CHART_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_CHART_SETTINGS;
  }
}

export function saveChartSettings(settings: ChartSettings): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}
