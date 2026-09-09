"use client";

import type { EventCategory, EventImportance, FeedTag } from "@/lib/world-tracker/types";
import type { DataStatus } from "@/lib/providers/types";
import { DataStatusBadge } from "@/components/terminal/DataStatusBadge";

const CATEGORIES: { value: EventCategory; label: string }[] = [
  { value: "finance", label: "Finance" },
  { value: "politics", label: "Politics" },
  { value: "geopolitics", label: "Geopolitics" },
  { value: "aviation", label: "Aviation / OSINT" },
];

const IMPORTANCES: { value: EventImportance; label: string }[] = [
  { value: "critical", label: "Critical" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];

const QUICK_TAGS: { value: FeedTag; label: string }[] = [
  { value: "breaking", label: "Breaking" },
  { value: "political_speech", label: "Market-moving speeches" },
  { value: "earnings", label: "Earnings" },
];

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-2.5 py-1 text-[11px] transition ${
        active
          ? "border-accent bg-accent/15 text-accent-strong"
          : "border-border text-text-secondary hover:bg-bg-hover"
      }`}
    >
      {children}
    </button>
  );
}

export function FilterBar({
  status,
  statusMessage,
  search,
  onSearchChange,
  activeCategories,
  onToggleCategory,
  activeImportances,
  onToggleImportance,
  activeTags,
  onToggleTag,
  eventCount,
}: {
  status: DataStatus;
  statusMessage?: string;
  search: string;
  onSearchChange: (value: string) => void;
  activeCategories: Set<EventCategory>;
  onToggleCategory: (category: EventCategory) => void;
  activeImportances: Set<EventImportance>;
  onToggleImportance: (importance: EventImportance) => void;
  activeTags: Set<FeedTag>;
  onToggleTag: (tag: FeedTag) => void;
  eventCount: number;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-bg-panel px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-text-primary">World Tracker</span>
        <DataStatusBadge status={status} />
        {status === "error" && statusMessage && <span className="text-[10px] text-text-muted">{statusMessage}</span>}
      </div>

      <input
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        placeholder="Search events, countries, tickers..."
        className="w-64 rounded-md border border-border bg-bg-panel-raised px-2.5 py-1.5 text-xs text-text-primary outline-none placeholder:text-text-muted focus:border-accent"
      />

      <div className="flex items-center gap-1.5">
        {CATEGORIES.map((c) => (
          <Chip key={c.value} active={activeCategories.has(c.value)} onClick={() => onToggleCategory(c.value)}>
            {c.label}
          </Chip>
        ))}
      </div>

      <div className="flex items-center gap-1.5 border-l border-border pl-3">
        {IMPORTANCES.map((i) => (
          <Chip key={i.value} active={activeImportances.has(i.value)} onClick={() => onToggleImportance(i.value)}>
            {i.label}
          </Chip>
        ))}
      </div>

      <div className="flex items-center gap-1.5 border-l border-border pl-3">
        {QUICK_TAGS.map((t) => (
          <Chip key={t.value} active={activeTags.has(t.value)} onClick={() => onToggleTag(t.value)}>
            {t.label}
          </Chip>
        ))}
      </div>

      <span className="ml-auto text-[11px] text-text-muted">{eventCount} events shown</span>
    </div>
  );
}
