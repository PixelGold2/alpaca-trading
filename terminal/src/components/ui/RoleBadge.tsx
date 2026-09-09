const ROLE_BADGE_STYLES: Record<string, string> = {
  founder: "bg-warning/15 text-warning border-warning/30",
  admin: "bg-accent/15 text-accent-strong border-accent/30",
  user: "bg-bg-hover text-text-muted border-border",
  viewer: "bg-bg-hover text-text-muted border-border",
};

export function RoleBadge({ role, className = "" }: { role: string; className?: string }) {
  return (
    <span
      className={`rounded border px-1 py-0 text-[9px] font-medium uppercase tracking-wide ${
        ROLE_BADGE_STYLES[role] ?? ROLE_BADGE_STYLES.user
      } ${className}`}
    >
      {role}
    </span>
  );
}
