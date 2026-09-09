import Link from "next/link";
import type { SessionUser } from "@/lib/auth/session";
import { hasRoleAtLeast } from "@/lib/auth/roles";

const NAV_ITEMS = [
  { href: "/", label: "Home" },
  { href: "/chats", label: "Chats" },
  { href: "/whats-new", label: "What's New" },
  { href: "/world-tracker", label: "World Tracker" },
  { href: "/watchlists", label: "Watchlists" },
  { href: "/markets", label: "Charts" },
  { href: "/news", label: "News" },
  { href: "/earnings", label: "Earnings" },
  { href: "/research", label: "Research" },
  { href: "/econ-calendar", label: "Economic Calendar" },
];

export function Sidebar({ role }: { role: SessionUser["role"] }) {
  return (
    <nav className="flex h-full w-48 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-border bg-bg-panel px-2 py-3">
      {NAV_ITEMS.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className="rounded px-2.5 py-1.5 text-xs text-text-secondary transition hover:bg-bg-hover hover:text-text-primary"
        >
          {item.label}
        </Link>
      ))}
      <div className="my-2 border-t border-border" />
      <Link
        href="/settings"
        className="rounded px-2.5 py-1.5 text-xs text-text-secondary transition hover:bg-bg-hover hover:text-text-primary"
      >
        Settings
      </Link>
      {hasRoleAtLeast(role, "admin") && (
        <Link
          href="/admin"
          className="rounded px-2.5 py-1.5 text-xs text-text-secondary transition hover:bg-bg-hover hover:text-text-primary"
        >
          Admin
        </Link>
      )}
    </nav>
  );
}
