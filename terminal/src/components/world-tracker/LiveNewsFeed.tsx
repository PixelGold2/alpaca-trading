"use client";

import { useState } from "react";
import type { EventCategory, WorldEvent } from "@/lib/world-tracker/types";

const IMPORTANCE_STYLES: Record<WorldEvent["importance"], string> = {
  critical: "bg-negative/15 text-negative border-negative/30",
  high: "bg-warning/15 text-warning border-warning/30",
  medium: "bg-attention/15 text-attention border-attention/30",
  low: "bg-bg-hover text-text-muted border-border",
};

const CATEGORY_LABELS: Record<EventCategory, string> = {
  finance: "Finance",
  politics: "Politics",
  geopolitics: "Geopolitics",
  aviation: "Aviation / OSINT",
};

const CATEGORY_ORDER: EventCategory[] = ["finance", "politics", "geopolitics", "aviation"];

function timeAgo(iso: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

function EventCard({
  event,
  selected,
  onSelect,
}: {
  event: WorldEvent;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={`block w-full border-b border-border px-3 py-2 text-left transition hover:bg-bg-hover ${
        selected ? "bg-bg-hover" : ""
      }`}
    >
      <div className="mb-1 flex items-center gap-1.5">
        <span
          className={`rounded border px-1.5 py-0.5 font-mono text-[9px] font-medium uppercase tracking-wide ${IMPORTANCE_STYLES[event.importance]}`}
        >
          {event.importance}
        </span>
        <span className="text-[10px] uppercase tracking-wide text-text-muted">
          {event.category} / {event.subcategory}
        </span>
      </div>
      <div className="mb-1 text-xs font-medium text-text-primary">{event.title}</div>
      <div className="flex flex-wrap items-center gap-x-2 text-[10px] text-text-muted">
        <span>{event.source}</span>
        <span>&middot;</span>
        <span>{timeAgo(event.publishedAt)}</span>
        <span>&middot;</span>
        <span>
          {event.location.city ? `${event.location.city}, ` : ""}
          {event.location.country}
        </span>
        {event.tickers.length > 0 && (
          <span className="rounded border border-accent/30 bg-accent/10 px-1 text-accent-strong">
            {event.tickers.join(", ")}
          </span>
        )}
      </div>
    </button>
  );
}

export function LiveNewsFeed({
  events,
  selectedEventId,
  onSelectEvent,
  hideEarnings,
  onToggleHideEarnings,
}: {
  events: WorldEvent[];
  selectedEventId: string | null;
  onSelectEvent: (id: string) => void;
  hideEarnings: boolean;
  onToggleHideEarnings: () => void;
}) {
  const [grouped, setGrouped] = useState(false);

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-bg-panel">
      <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-2">
        <span className="text-xs font-medium text-text-primary">Live Feed</span>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1 text-[10px] text-text-secondary">
            <input type="checkbox" checked={hideEarnings} onChange={onToggleHideEarnings} />
            Hide earnings
          </label>
          <div className="flex items-center gap-1 rounded border border-border p-0.5 text-[10px]">
            <button
              onClick={() => setGrouped(false)}
              className={`rounded px-1.5 py-0.5 ${!grouped ? "bg-accent text-white" : "text-text-secondary hover:bg-bg-hover"}`}
            >
              Mixed
            </button>
            <button
              onClick={() => setGrouped(true)}
              className={`rounded px-1.5 py-0.5 ${grouped ? "bg-accent text-white" : "text-text-secondary hover:bg-bg-hover"}`}
            >
              By category
            </button>
          </div>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {events.length === 0 && (
          <div className="p-4 text-center text-xs text-text-muted">No events match the current filters.</div>
        )}

        {!grouped &&
          events.map((event) => (
            <EventCard
              key={event.id}
              event={event}
              selected={selectedEventId === event.id}
              onSelect={() => onSelectEvent(event.id)}
            />
          ))}

        {grouped &&
          CATEGORY_ORDER.map((category) => {
            const items = events.filter((e) => e.category === category);
            if (items.length === 0) return null;
            return (
              <div key={category}>
                <div className="sticky top-0 border-b border-t border-border bg-bg-panel-raised px-3 py-1 text-[10px] font-medium uppercase tracking-wide text-text-secondary">
                  {CATEGORY_LABELS[category]} ({items.length})
                </div>
                {items.map((event) => (
                  <EventCard
                    key={event.id}
                    event={event}
                    selected={selectedEventId === event.id}
                    onSelect={() => onSelectEvent(event.id)}
                  />
                ))}
              </div>
            );
          })}
      </div>
    </div>
  );
}
