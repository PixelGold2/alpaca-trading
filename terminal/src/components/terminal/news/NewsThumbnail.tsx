"use client";

export function NewsThumbnail({ src, className = "h-16 w-24 shrink-0 rounded object-cover" }: { src: string; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- external, unpredictable-domain news thumbnails; not worth next/image's remote-pattern config for a best-effort visual
    <img
      src={src}
      alt=""
      className={className}
      onError={(e) => {
        e.currentTarget.style.display = "none";
      }}
    />
  );
}
