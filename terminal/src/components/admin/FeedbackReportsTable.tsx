"use client";

import { useState } from "react";
import { updateFeedbackStatus } from "@/app/actions/feedback";

export interface FeedbackReportRow {
  id: string;
  type: "feedback" | "bug";
  description: string;
  pageUrl: string | null;
  imageDataUrl: string | null;
  status: "open" | "reviewed" | "resolved";
  submitterEmail: string | null;
  createdAt: string;
}

type TypeFilter = "all" | "feedback" | "bug";
type StatusFilter = "all" | "open" | "reviewed" | "resolved";

const TYPE_STYLES: Record<FeedbackReportRow["type"], string> = {
  feedback: "bg-accent/15 text-accent-strong border-accent/30",
  bug: "bg-negative/15 text-negative border-negative/30",
};

const STATUS_OPTIONS: FeedbackReportRow["status"][] = ["open", "reviewed", "resolved"];

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full border px-2.5 py-1 text-[11px] transition ${
        active ? "border-accent bg-accent/15 text-accent-strong" : "border-border text-text-secondary hover:bg-bg-hover"
      }`}
    >
      {children}
    </button>
  );
}

export function FeedbackReportsTable({ reports }: { reports: FeedbackReportRow[] }) {
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [expandedImage, setExpandedImage] = useState<string | null>(null);

  const filtered = reports.filter(
    (r) => (typeFilter === "all" || r.type === typeFilter) && (statusFilter === "all" || r.status === statusFilter),
  );

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] uppercase tracking-wide text-text-muted">Type</span>
        <FilterChip active={typeFilter === "all"} onClick={() => setTypeFilter("all")}>All</FilterChip>
        <FilterChip active={typeFilter === "feedback"} onClick={() => setTypeFilter("feedback")}>Feedback</FilterChip>
        <FilterChip active={typeFilter === "bug"} onClick={() => setTypeFilter("bug")}>Bug Report</FilterChip>

        <span className="ml-2 text-[10px] uppercase tracking-wide text-text-muted">Status</span>
        <FilterChip active={statusFilter === "all"} onClick={() => setStatusFilter("all")}>All</FilterChip>
        <FilterChip active={statusFilter === "open"} onClick={() => setStatusFilter("open")}>Open</FilterChip>
        <FilterChip active={statusFilter === "reviewed"} onClick={() => setStatusFilter("reviewed")}>Reviewed</FilterChip>
        <FilterChip active={statusFilter === "resolved"} onClick={() => setStatusFilter("resolved")}>Resolved</FilterChip>
      </div>

      {filtered.length === 0 ? (
        <p className="text-xs text-text-muted">No reports match these filters.</p>
      ) : (
        <div className="space-y-2">
          {filtered.map((r) => (
            <div key={r.id} className="rounded-md border border-border bg-bg-panel-raised p-3">
              <div className="mb-1.5 flex flex-wrap items-center gap-2">
                <span className={`rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${TYPE_STYLES[r.type]}`}>
                  {r.type === "bug" ? "Bug" : "Feedback"}
                </span>
                <span className="text-[10px] text-text-muted">
                  {r.submitterEmail ?? "Unknown user"} &middot; {new Date(r.createdAt).toLocaleString()}
                </span>
                {r.pageUrl && <span className="truncate text-[10px] text-text-muted">on {r.pageUrl}</span>}
                <select
                  value={r.status}
                  onChange={(e) => updateFeedbackStatus(r.id, e.target.value as FeedbackReportRow["status"])}
                  className="ml-auto rounded border border-border bg-bg-panel px-1.5 py-0.5 text-[10px] text-text-primary outline-none"
                >
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {s[0].toUpperCase() + s.slice(1)}
                    </option>
                  ))}
                </select>
              </div>

              <p className="whitespace-pre-wrap text-xs text-text-secondary">{r.description}</p>

              {r.imageDataUrl && (
                // eslint-disable-next-line @next/next/no-img-element -- data: URI decoded from DB bytea, not a static/optimizable asset
                <img
                  src={r.imageDataUrl}
                  alt="Attached screenshot"
                  onClick={() => setExpandedImage(r.imageDataUrl)}
                  className="mt-2 max-h-28 cursor-zoom-in rounded border border-border"
                />
              )}
            </div>
          ))}
        </div>
      )}

      {expandedImage && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-8"
          onClick={() => setExpandedImage(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- data: URI decoded from DB bytea, not a static/optimizable asset */}
          <img src={expandedImage} alt="Attached screenshot, expanded" className="max-h-full max-w-full rounded-lg" />
        </div>
      )}
    </div>
  );
}
