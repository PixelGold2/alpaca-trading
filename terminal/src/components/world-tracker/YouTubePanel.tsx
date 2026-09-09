"use client";

import { useState } from "react";

interface Channel {
  id: string; // YouTube channel ID (UC...)
  name: string;
}

// Official channel IDs (verified against each channel's canonical YouTube
// URL). Uses YouTube's own /embed/live_stream endpoint, which resolves to
// whatever the channel currently has live — no scraping, no API key needed
// for this basic embed-and-switch use case. If a channel isn't live, YouTube's
// embedded player shows its own "offline" state rather than us faking one.
const CHANNELS: Channel[] = [
  { id: "UChqUTb7kYRX8-EiaN3XFrSQ", name: "Reuters" },
  { id: "UCIALMKvObZNtJ6AmdCLP7Lg", name: "Bloomberg Television" },
  { id: "UCNye-wNBqNL5ZzHSJj3l8Bg", name: "Al Jazeera English" },
  { id: "UCknLrEdhRCp1aegoMqRaCZg", name: "DW News" },
  { id: "UCoMdktPbSTixAyNGwb-UYkQ", name: "Sky News" },
];

export function YouTubePanel() {
  const [activeId, setActiveId] = useState(CHANNELS[0].id);

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-bg-panel">
      <div className="shrink-0 border-b border-border px-3 py-2 text-xs font-medium text-text-primary">
        Live News Broadcasts
      </div>
      <div className="min-h-0 flex-1 bg-black">
        <iframe
          key={activeId}
          className="h-full w-full"
          src={`https://www.youtube.com/embed/live_stream?channel=${activeId}`}
          title="Live news broadcast"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      </div>
      <div className="flex shrink-0 flex-wrap gap-1 border-t border-border p-1.5">
        {CHANNELS.map((channel) => (
          <button
            key={channel.id}
            onClick={() => setActiveId(channel.id)}
            className={`rounded px-2 py-1 text-[11px] transition ${
              activeId === channel.id
                ? "bg-accent text-white"
                : "text-text-secondary hover:bg-bg-hover"
            }`}
          >
            {channel.name}
          </button>
        ))}
      </div>
    </div>
  );
}
