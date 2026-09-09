"use client";

import type { WorldEvent } from "@/lib/world-tracker/types";

const PRECISION_LABEL: Record<WorldEvent["locationPrecision"], string> = {
  exact: "Exact location",
  city: "City-level location",
  region: "Region-level location (approximate)",
  country: "Country-level location (approximate)",
};

export function EventDetailCard({ event, onClose }: { event: WorldEvent; onClose: () => void }) {
  return (
    <div className="absolute inset-0 z-10 flex items-start justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-lg border border-border-strong bg-bg-panel-raised p-4 shadow-xl">
        <div className="mb-2 flex items-start justify-between gap-3">
          <h2 className="text-sm font-medium text-text-primary">{event.title}</h2>
          <button
            onClick={onClose}
            className="shrink-0 rounded px-1.5 py-0.5 text-xs text-text-muted hover:bg-bg-hover hover:text-text-primary"
          >
            Esc
          </button>
        </div>

        <div className="mb-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-text-muted">
          <span>{event.source}</span>
          <span>{new Date(event.publishedAt).toLocaleString()}</span>
          <span className="uppercase">
            {event.category} / {event.subcategory}
          </span>
        </div>

        <p className="mb-3 text-xs leading-relaxed text-text-secondary">{event.description}</p>

        <div className="mb-3 space-y-1 text-[11px] text-text-muted">
          <div>
            Location: {event.location.city ? `${event.location.city}, ` : ""}
            {event.location.region ? `${event.location.region}, ` : ""}
            {event.location.country}
          </div>
          <div className="text-text-muted/80">{PRECISION_LABEL[event.locationPrecision]}</div>
        </div>

        {event.tickers.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-1.5">
            {event.tickers.map((ticker) => (
              <span
                key={ticker}
                className="rounded border border-accent/30 bg-accent/10 px-1.5 py-0.5 font-mono text-[10px] text-accent-strong"
              >
                {ticker}
              </span>
            ))}
          </div>
        )}

        <a
          href={event.url}
          target="_blank"
          rel="noreferrer"
          className="inline-block rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-strong"
        >
          Open original source
        </a>
      </div>
    </div>
  );
}
