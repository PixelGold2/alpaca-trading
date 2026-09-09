"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { submitFeedback, type FeedbackState } from "@/app/actions/feedback";

type ReportType = "feedback" | "bug";

const initialState: FeedbackState = {};

function MessageIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

// Owns useActionState itself so mounting/unmounting this component (rather
// than just hiding it) resets the form state — otherwise a stale success/
// error from a previous submission would flash again the next time the
// widget is reopened, since useActionState's state persists for as long as
// the component calling it stays mounted.
function FeedbackForm({ onClose }: { onClose: () => void }) {
  const [type, setType] = useState<ReportType>("feedback");
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pathname = usePathname();
  const [state, formAction, pending] = useActionState(submitFeedback, initialState);

  useEffect(() => {
    return () => {
      if (imagePreview) URL.revokeObjectURL(imagePreview);
    };
  }, [imagePreview]);

  function handleImageChange(file: File | null) {
    setImagePreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return file ? URL.createObjectURL(file) : null;
    });
    if (!file && fileInputRef.current) fileInputRef.current.value = "";
  }

  if (state.success) {
    return (
      <div className="space-y-2 py-2 text-center">
        <p className="text-xs text-positive">Thanks — your report was submitted.</p>
        <button
          onClick={onClose}
          className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-strong"
        >
          Close
        </button>
      </div>
    );
  }

  return (
    <form
      action={(formData) => {
        formData.set("pageUrl", pathname);
        formAction(formData);
      }}
      className="space-y-2.5"
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-text-primary">Send feedback</span>
        <button type="button" onClick={onClose} className="text-text-muted hover:text-text-primary">
          ✕
        </button>
      </div>

      <div className="flex items-center gap-1 rounded-md border border-border p-0.5">
        <button
          type="button"
          onClick={() => setType("feedback")}
          className={`flex-1 rounded px-2 py-1 text-[11px] ${
            type === "feedback" ? "bg-accent text-white" : "text-text-secondary hover:bg-bg-hover"
          }`}
        >
          Feedback
        </button>
        <button
          type="button"
          onClick={() => setType("bug")}
          className={`flex-1 rounded px-2 py-1 text-[11px] ${
            type === "bug" ? "bg-accent text-white" : "text-text-secondary hover:bg-bg-hover"
          }`}
        >
          Bug Report
        </button>
      </div>
      <input type="hidden" name="type" value={type} />

      <textarea
        name="description"
        required
        disabled={pending}
        rows={4}
        placeholder={type === "bug" ? "What went wrong? Steps to reproduce help a lot." : "What's on your mind?"}
        className="w-full resize-none rounded-md border border-border bg-bg-panel px-2.5 py-2 text-xs text-text-primary outline-none focus:border-accent"
      />

      <div className="space-y-1.5">
        <label className="block text-[10px] text-text-muted">Screenshot (optional)</label>
        <input
          ref={fileInputRef}
          type="file"
          name="image"
          accept="image/*"
          disabled={pending}
          onChange={(e) => handleImageChange(e.target.files?.[0] ?? null)}
          className="w-full text-[10px] text-text-secondary file:mr-2 file:rounded file:border file:border-border file:bg-bg-panel file:px-2 file:py-1 file:text-[10px] file:text-text-secondary"
        />
        {imagePreview && (
          <div className="relative inline-block">
            {/* eslint-disable-next-line @next/next/no-img-element -- transient client-side object URL preview, not an optimizable static asset */}
            <img src={imagePreview} alt="Attachment preview" className="max-h-24 rounded border border-border" />
            <button
              type="button"
              onClick={() => handleImageChange(null)}
              className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-negative text-[10px] text-white"
              title="Remove"
            >
              ✕
            </button>
          </div>
        )}
      </div>

      {state.error && <p className="text-[11px] text-negative">{state.error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-accent py-1.5 text-xs font-medium text-white hover:bg-accent-strong disabled:opacity-60"
      >
        {pending ? "Sending..." : "Send"}
      </button>
    </form>
  );
}

export function FeedbackWidget() {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  return (
    <div ref={containerRef} className="fixed bottom-4 right-4 z-30">
      {open && (
        <div className="mb-2 w-80 rounded-lg border border-border-strong bg-bg-panel-raised p-3 shadow-2xl">
          <FeedbackForm onClose={() => setOpen(false)} />
        </div>
      )}

      <button
        onClick={() => setOpen((v) => !v)}
        className="flex h-11 w-11 items-center justify-center rounded-full bg-accent text-white shadow-lg hover:bg-accent-strong"
        title="Feedback / Bug report"
      >
        <MessageIcon />
      </button>
    </div>
  );
}
