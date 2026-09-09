"use client";

import { useMemo } from "react";
import type { EconEvent } from "@/lib/econ-calendar/fred-econ-calendar";
import { ActualVsPrevious, CATEGORY_LABELS, CATEGORY_ORDER, formatDateHeading } from "@/components/terminal/econ-calendar/shared";

export function EconCalendarList({ events }: { events: EconEvent[] }) {
  const byDate = useMemo(() => {
    const groups = new Map<string, EconEvent[]>();
    for (const e of events) {
      const list = groups.get(e.date) ?? [];
      list.push(e);
      groups.set(e.date, list);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [events]);

  if (byDate.length === 0) {
    return <p className="text-xs text-text-muted">No tracked releases scheduled in this range.</p>;
  }

  return (
    <div className="space-y-4">
      {byDate.map(([date, dayEvents]) => (
        <div key={date} className="rounded-lg border border-border bg-bg-panel">
          <h2 className="border-b border-border px-4 py-2 text-xs font-medium text-text-primary">
            {formatDateHeading(date)}
          </h2>
          <div className="divide-y divide-border/50">
            {CATEGORY_ORDER.filter((c) => dayEvents.some((e) => e.category === c)).map((category) => (
              <div key={category} className="px-4 py-2">
                <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-text-muted">
                  {CATEGORY_LABELS[category]}
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {dayEvents
                    .filter((e) => e.category === category)
                    .map((e) => (
                      <div
                        key={`${e.seriesId}-${e.date}`}
                        className="rounded-md border border-border bg-bg-panel-raised p-2.5"
                      >
                        <div className="mb-1 text-xs font-medium text-text-primary">{e.name}</div>
                        <ActualVsPrevious actual={e.actual} previous={e.previous} unit={e.unit} />
                      </div>
                    ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
