"use client";

import { useEffect, useState } from "react";
import { DataStatusBadge } from "@/components/terminal/DataStatusBadge";
import type { DataStatus } from "@/lib/providers/types";
import type { InstrumentCategory, TickerInstrument } from "@/lib/market-data/ticker-instruments";

const CATEGORIES: { value: InstrumentCategory; label: string }[] = [
  { value: "markets", label: "Markets" },
  { value: "forex", label: "Forex" },
  { value: "crypto", label: "Crypto" },
  { value: "futures", label: "Futures" },
];

const POLL_MS = 60_000;

function Row({ inst }: { inst: TickerInstrument }) {
  const positive = inst.changePercent >= 0;
  return (
    <div className="flex shrink-0 items-center gap-1.5 px-4 text-[11px]">
      <span className="font-medium text-text-primary">{inst.label}</span>
      <span className="font-mono text-text-secondary">
        {inst.price.toLocaleString(undefined, { maximumFractionDigits: inst.price < 10 ? 4 : 2 })}
      </span>
      <span className={`font-mono ${positive ? "text-positive" : "text-negative"}`}>
        {positive ? "+" : ""}
        {inst.changePercent.toFixed(2)}%
      </span>
    </div>
  );
}

export function CategoryTicker() {
  const [active, setActive] = useState<InstrumentCategory>("markets");
  const [instruments, setInstruments] = useState<TickerInstrument[]>([]);
  const [status, setStatus] = useState<DataStatus>("live");
  const [message, setMessage] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;
    function poll() {
      fetch(`/api/market-data/ticker?category=${active}`)
        .then((res) => res.json())
        .then((body: { data: TickerInstrument[] | null; meta: { status: DataStatus; message?: string } }) => {
          if (cancelled) return;
          setInstruments(body.data ?? []);
          setStatus(body.meta.status);
          setMessage(body.meta.message);
        })
        .catch(() => {
          if (cancelled) return;
          setStatus("error");
        });
    }
    poll();
    const id = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [active]);

  return (
    <div className="flex h-8 shrink-0 items-center gap-3 overflow-hidden border-b border-border bg-bg-panel px-3">
      <div className="flex shrink-0 items-center gap-1">
        {CATEGORIES.map((c) => (
          <button
            key={c.value}
            onClick={() => setActive(c.value)}
            className={`rounded px-2 py-1 text-[11px] transition ${
              active === c.value ? "bg-accent text-white" : "text-text-secondary hover:bg-bg-hover"
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>
      <DataStatusBadge status={status} />
      {instruments.length > 0 ? (
        <div className="relative min-w-0 flex-1 overflow-hidden">
          <div className="ticker-marquee flex w-max items-center">
            {instruments.map((inst) => (
              <Row key={`a-${inst.symbol}`} inst={inst} />
            ))}
            {instruments.map((inst) => (
              <Row key={`b-${inst.symbol}`} inst={inst} />
            ))}
          </div>
        </div>
      ) : (
        <span className="truncate text-[11px] text-text-muted">{message ?? "No data available."}</span>
      )}
      <style jsx>{`
        .ticker-marquee {
          animation: ticker-scroll 25s linear infinite;
        }
        @keyframes ticker-scroll {
          from {
            transform: translateX(0);
          }
          to {
            transform: translateX(-50%);
          }
        }
      `}</style>
    </div>
  );
}
