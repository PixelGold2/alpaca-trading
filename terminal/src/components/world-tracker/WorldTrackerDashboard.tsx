"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { DataStatus, ProviderResult } from "@/lib/providers/types";
import type { EventCategory, EventImportance, FeedTag, WorldEvent } from "@/lib/world-tracker/types";
import { FilterBar } from "@/components/world-tracker/FilterBar";
import { WorldMap } from "@/components/world-tracker/WorldMap";
import { LiveNewsFeed } from "@/components/world-tracker/LiveNewsFeed";
import { EventDetailCard } from "@/components/world-tracker/EventDetailCard";
import { YouTubePanel } from "@/components/world-tracker/YouTubePanel";
import { AIReportPanel } from "@/components/world-tracker/AIReportPanel";

const MAX_EVENTS = 200;

export function WorldTrackerDashboard() {
  const [events, setEvents] = useState<WorldEvent[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [activeCategories, setActiveCategories] = useState<Set<EventCategory>>(new Set());
  const [activeImportances, setActiveImportances] = useState<Set<EventImportance>>(new Set());
  const [activeTags, setActiveTags] = useState<Set<FeedTag>>(new Set());
  const [hideEarnings, setHideEarnings] = useState(false);
  const [rightBottomTab, setRightBottomTab] = useState<"youtube" | "ai">("youtube");
  const [feedStatus, setFeedStatus] = useState<DataStatus>("live");
  const [feedMessage, setFeedMessage] = useState<string | undefined>();
  const seenIds = useRef(new Set<string>());

  useEffect(() => {
    const source = new EventSource("/api/world-tracker/stream");

    source.addEventListener("batch", (e) => {
      const payload = JSON.parse(e.data) as ProviderResult<WorldEvent[]>;
      const batch = payload.data ?? [];
      batch.forEach((event) => seenIds.current.add(event.id));
      setEvents(batch.sort((a, b) => +new Date(b.publishedAt) - +new Date(a.publishedAt)));
      setFeedStatus(payload.meta.status);
      setFeedMessage(payload.meta.message);
    });

    source.addEventListener("event", (e) => {
      const payload = JSON.parse(e.data) as ProviderResult<WorldEvent>;
      const event = payload.data;
      if (!event || seenIds.current.has(event.id)) return;
      seenIds.current.add(event.id);
      setEvents((prev) => [event, ...prev].slice(0, MAX_EVENTS));
    });

    return () => source.close();
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setSelectedEventId(null);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const filteredEvents = useMemo(() => {
    const query = search.trim().toLowerCase();
    return events.filter((event) => {
      if (activeCategories.size > 0 && !activeCategories.has(event.category)) return false;
      if (activeImportances.size > 0 && !activeImportances.has(event.importance)) return false;
      if (activeTags.size > 0 && ![...activeTags].some((tag) => event.tags.includes(tag))) return false;
      if (hideEarnings && event.tags.includes("earnings")) return false;
      if (!query) return true;
      const haystack = [
        event.title,
        event.description,
        event.location.country,
        event.location.city ?? "",
        event.category,
        event.source,
        ...event.tickers,
        ...event.tags,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [events, search, activeCategories, activeImportances, activeTags, hideEarnings]);

  const selectedEvent = events.find((e) => e.id === selectedEventId) ?? null;

  function toggleCategory(category: EventCategory) {
    setActiveCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  }

  function toggleImportance(importance: EventImportance) {
    setActiveImportances((prev) => {
      const next = new Set(prev);
      if (next.has(importance)) next.delete(importance);
      else next.add(importance);
      return next;
    });
  }

  function toggleTag(tag: FeedTag) {
    setActiveTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <FilterBar
        status={feedStatus}
        statusMessage={feedMessage}
        search={search}
        onSearchChange={setSearch}
        activeCategories={activeCategories}
        onToggleCategory={toggleCategory}
        activeImportances={activeImportances}
        onToggleImportance={toggleImportance}
        activeTags={activeTags}
        onToggleTag={toggleTag}
        eventCount={filteredEvents.length}
      />

      <div className="grid min-h-0 flex-1 grid-cols-[1fr_360px] gap-3">
        <div className="relative min-h-0">
          <WorldMap events={filteredEvents} selectedEventId={selectedEventId} onSelectEvent={setSelectedEventId} />
          {selectedEvent && <EventDetailCard event={selectedEvent} onClose={() => setSelectedEventId(null)} />}
        </div>

        <div className="grid min-h-0 grid-rows-[1.3fr_1fr] gap-3">
          <LiveNewsFeed
            events={filteredEvents}
            selectedEventId={selectedEventId}
            onSelectEvent={setSelectedEventId}
            hideEarnings={hideEarnings}
            onToggleHideEarnings={() => setHideEarnings((v) => !v)}
          />

          <div className="flex min-h-0 flex-col gap-1">
            <div className="flex shrink-0 items-center gap-1 self-start rounded border border-border p-0.5">
              <button
                onClick={() => setRightBottomTab("youtube")}
                className={`rounded px-2 py-1 text-[11px] ${
                  rightBottomTab === "youtube" ? "bg-accent text-white" : "text-text-secondary hover:bg-bg-hover"
                }`}
              >
                YouTube
              </button>
              <button
                onClick={() => setRightBottomTab("ai")}
                className={`rounded px-2 py-1 text-[11px] ${
                  rightBottomTab === "ai" ? "bg-accent text-white" : "text-text-secondary hover:bg-bg-hover"
                }`}
              >
                AI Analysis
              </button>
            </div>
            <div className="min-h-0 flex-1">
              {rightBottomTab === "youtube" ? <YouTubePanel /> : <AIReportPanel events={events} />}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
