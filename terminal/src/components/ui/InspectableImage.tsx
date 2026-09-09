"use client";

import { useState } from "react";
import { ImageLightbox } from "@/components/ui/ImageLightbox";

export function InspectableImage({
  src,
  alt = "",
  className = "",
}: {
  src: string;
  alt?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element -- data: URI decoded from DB bytea, not a static/optimizable asset */}
      <img
        src={src}
        alt={alt}
        onClick={() => setOpen(true)}
        className={`cursor-zoom-in transition hover:opacity-90 ${className}`}
      />
      {open && <ImageLightbox src={src} onClose={() => setOpen(false)} />}
    </>
  );
}
