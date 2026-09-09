import type { DataStatus } from "@/lib/market-data/types";

const STYLES: Record<DataStatus, string> = {
  live: "bg-positive/15 text-positive border-positive/30",
  delayed: "bg-warning/15 text-warning border-warning/30",
  stale: "bg-warning/15 text-warning border-warning/30",
  error: "bg-negative/15 text-negative border-negative/30",
  demo: "bg-demo/15 text-demo border-demo/30",
};

const LABELS: Record<DataStatus, string> = {
  live: "LIVE",
  delayed: "DELAYED",
  stale: "STALE",
  error: "ERROR",
  demo: "DEMO",
};

export function DataStatusBadge({ status }: { status: DataStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-[10px] font-medium tracking-wide ${STYLES[status]}`}
    >
      {LABELS[status]}
    </span>
  );
}
