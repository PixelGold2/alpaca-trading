"use client";

import { useState } from "react";

function RefreshIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={spinning ? "animate-spin" : ""}
    >
      <path d="M3 12a9 9 0 0 1 15.3-6.4L21 8M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-15.3 6.4L3 16M3 21v-5h5" />
    </svg>
  );
}

// A full reload rather than router.refresh() — deliberately: several pages fetch
// their own data client-side (PriceChart's bars, FundamentalsPanel's profile/
// ratios/statements), which a soft RSC refresh wouldn't touch. This button is a
// blunt "start over" for whatever page you're on, not a targeted data refetch.
export function RefreshButton() {
  const [spinning, setSpinning] = useState(false);

  return (
    <button
      onClick={() => {
        setSpinning(true);
        window.location.reload();
      }}
      title="Refresh this page"
      className="flex items-center gap-1 rounded px-1.5 py-1 text-[10px] text-text-secondary transition hover:bg-bg-hover"
    >
      <RefreshIcon spinning={spinning} />
    </button>
  );
}
