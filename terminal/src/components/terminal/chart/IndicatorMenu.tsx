"use client";

import { useEffect, useRef, useState } from "react";
import { OVERLAY_INDICATORS, OSCILLATOR_INDICATORS, type Indicators } from "@/lib/indicators/config";

export function IndicatorMenu({
  indicators,
  onChange,
}: {
  indicators: Indicators;
  onChange: (next: Indicators) => void;
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

  const activeCount = Object.values(indicators).filter(Boolean).length;

  function toggle(key: keyof Indicators) {
    onChange({ ...indicators, [key]: !indicators[key] });
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs transition ${
          open ? "border-accent text-accent-strong" : "border-border text-text-secondary hover:bg-bg-hover"
        }`}
      >
        Indicators
        {activeCount > 0 && (
          <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] text-white">
            {activeCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 w-64 rounded-md border border-border-strong bg-bg-panel-raised p-3 shadow-xl">
          <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-text-muted">Overlays</div>
          <div className="mb-3 space-y-1.5">
            {OVERLAY_INDICATORS.map(({ key, label }) => (
              <label key={key} className="flex items-center gap-2 text-xs text-text-secondary">
                <input
                  type="checkbox"
                  checked={indicators[key]}
                  onChange={() => toggle(key)}
                  className="h-3.5 w-3.5 rounded border-border-strong bg-bg-panel accent-accent"
                />
                {label}
              </label>
            ))}
          </div>

          <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-text-muted">Oscillators</div>
          <div className="space-y-1.5">
            {OSCILLATOR_INDICATORS.map(({ key, label }) => (
              <label key={key} className="flex items-center gap-2 text-xs text-text-secondary">
                <input
                  type="checkbox"
                  checked={indicators[key]}
                  onChange={() => toggle(key)}
                  className="h-3.5 w-3.5 rounded border-border-strong bg-bg-panel accent-accent"
                />
                {label}
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
