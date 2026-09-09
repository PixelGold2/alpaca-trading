"use client";

import { useEffect, useRef, useState } from "react";
import { DEFAULT_CHART_SETTINGS, type ChartSettings } from "@/lib/preferences/chart-settings";

const CROSSHAIR_MODES: { value: ChartSettings["crosshairMode"]; label: string }[] = [
  { value: "normal", label: "Normal" },
  { value: "magnet", label: "Magnet" },
  { value: "hidden", label: "Hidden" },
];

function ColorRow({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center justify-between text-xs text-text-secondary">
      {label}
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-6 w-6 cursor-pointer rounded border border-border bg-transparent p-0"
      />
    </label>
  );
}

export function ChartSettingsMenu({
  settings,
  onChange,
}: {
  settings: ChartSettings;
  onChange: (settings: ChartSettings) => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  function update(patch: Partial<ChartSettings>) {
    onChange({ ...settings, ...patch });
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs transition ${
          open ? "border-accent text-accent-strong" : "border-border text-text-secondary hover:bg-bg-hover"
        }`}
      >
        Chart Settings
      </button>

      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 w-72 space-y-3 rounded-md border border-border-strong bg-bg-panel-raised p-3 shadow-xl">
          <div>
            <h3 className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-text-muted">Candles</h3>
            <div className="space-y-1.5">
              <ColorRow label="Up" value={settings.upColor} onChange={(v) => update({ upColor: v })} />
              <ColorRow label="Down" value={settings.downColor} onChange={(v) => update({ downColor: v })} />
            </div>
          </div>

          <div>
            <h3 className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-text-muted">
              Background &amp; Grid
            </h3>
            <div className="space-y-1.5">
              <ColorRow label="Background" value={settings.background} onChange={(v) => update({ background: v })} />
              <ColorRow label="Grid color" value={settings.gridColor} onChange={(v) => update({ gridColor: v })} />
              <label className="flex items-center gap-1.5 text-xs text-text-secondary">
                <input
                  type="checkbox"
                  checked={settings.gridVisible}
                  onChange={(e) => update({ gridVisible: e.target.checked })}
                  className="h-3.5 w-3.5 rounded border-border-strong bg-bg-panel accent-accent"
                />
                Show grid
              </label>
            </div>
          </div>

          <div>
            <h3 className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-text-muted">Crosshair</h3>
            <div className="flex items-center gap-1 rounded-md border border-border p-0.5">
              {CROSSHAIR_MODES.map((mode) => (
                <button
                  key={mode.value}
                  onClick={() => update({ crosshairMode: mode.value })}
                  className={`flex-1 rounded px-2 py-1 text-[11px] ${
                    settings.crosshairMode === mode.value
                      ? "bg-accent text-white"
                      : "text-text-secondary hover:bg-bg-hover"
                  }`}
                >
                  {mode.label}
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={() => onChange(DEFAULT_CHART_SETTINGS)}
            className="w-full rounded-md border border-border py-1 text-[11px] text-text-muted hover:bg-bg-hover"
          >
            Reset to defaults
          </button>
        </div>
      )}
    </div>
  );
}
