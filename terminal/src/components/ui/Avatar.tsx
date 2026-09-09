function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return parts
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

export function Avatar({
  userId,
  name,
  hasAvatar,
  size = 28,
  className = "",
}: {
  userId: string;
  name: string;
  hasAvatar: boolean;
  size?: number;
  className?: string;
}) {
  const style = { width: size, height: size, fontSize: Math.max(9, size * 0.38) };

  if (hasAvatar) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- served from a private, session-gated API route, not a static/optimizable asset
      <img
        src={`/api/users/${userId}/avatar`}
        alt=""
        style={style}
        className={`shrink-0 rounded-full border border-border object-cover ${className}`}
      />
    );
  }

  return (
    <div
      style={style}
      className={`flex shrink-0 items-center justify-center rounded-full border border-border bg-bg-hover font-medium text-text-secondary ${className}`}
    >
      {initialsFor(name)}
    </div>
  );
}
