"use client";

import { useEffect } from "react";

export function ImageLightbox({ src, onClose }: { src: string; onClose: () => void }) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6"
      onClick={onClose}
    >
      <button
        onClick={onClose}
        aria-label="Close"
        className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full bg-bg-panel-raised text-text-primary hover:bg-bg-hover"
      >
        ✕
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element -- full-size inspection of an already-loaded data: URI, not an optimizable static asset */}
      <img
        src={src}
        alt=""
        className="max-h-full max-w-full rounded object-contain"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}
