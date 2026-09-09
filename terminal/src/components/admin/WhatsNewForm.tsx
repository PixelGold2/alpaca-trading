"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { createWhatsNewPost, type WhatsNewState } from "@/app/actions/whats-new";

const initialState: WhatsNewState = {};

export function WhatsNewForm() {
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState(createWhatsNewPost, initialState);

  // Clear the image preview the moment a submission succeeds — "adjust state
  // during render" (react.dev) instead of an effect, so there's no extra
  // render/flash between the success state landing and the preview clearing.
  const [prevState, setPrevState] = useState(state);
  if (state !== prevState) {
    setPrevState(state);
    if (state.success && imagePreview) {
      URL.revokeObjectURL(imagePreview);
      setImagePreview(null);
    }
  }

  // formRef.current?.reset() is a DOM action, not state — stays in an effect.
  useEffect(() => {
    if (state.success) formRef.current?.reset();
  }, [state.success]);

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

  return (
    <form ref={formRef} action={formAction} className="space-y-2.5">
      <input
        name="title"
        required
        disabled={pending}
        placeholder="Title (e.g. Live vessel tracking)"
        className="w-full rounded-md border border-border bg-bg-panel px-2.5 py-1.5 text-xs text-text-primary outline-none focus:border-accent"
      />

      <textarea
        name="body"
        required
        disabled={pending}
        rows={4}
        placeholder="What's new, and what it does..."
        className="w-full resize-none rounded-md border border-border bg-bg-panel px-2.5 py-2 text-xs text-text-primary outline-none focus:border-accent"
      />

      <div className="space-y-1.5">
        <label className="block text-[10px] text-text-muted">Photo (optional)</label>
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
            <img src={imagePreview} alt="Attachment preview" className="max-h-32 rounded border border-border" />
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
      {state.success && <p className="text-[11px] text-positive">Posted — now visible to everyone on What&apos;s New.</p>}

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-strong disabled:opacity-60"
      >
        {pending ? "Posting..." : "Post update"}
      </button>
    </form>
  );
}
