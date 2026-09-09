import type { SessionUser } from "@/lib/auth/session";
import { ClientClock } from "@/components/terminal/ClientClock";
import { LogoutButton } from "@/components/auth/LogoutButton";
import { PreferenceToggles } from "@/components/terminal/PreferenceToggles";
import { NotificationBell } from "@/components/terminal/NotificationBell";
import { RefreshButton } from "@/components/terminal/RefreshButton";
import { GlobalTickerSearch } from "@/components/terminal/GlobalTickerSearch";

const ROLE_LABELS: Record<SessionUser["role"], string> = {
  founder: "Founder",
  admin: "Admin",
  user: "User",
  viewer: "Viewer",
};

export function TopBar({ user }: { user: SessionUser }) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-4 border-b border-border bg-bg-panel px-3">
      <div className="font-mono text-sm font-semibold tracking-tight text-text-primary">
        <span className="text-accent-strong">&gt;</span> TERMINAL
      </div>

      <div className="flex-1">
        <GlobalTickerSearch />
      </div>

      <ClientClock />
      <RefreshButton />
      <PreferenceToggles />
      <NotificationBell />

      <div className="flex items-center gap-2 border-l border-border pl-3">
        <div className="text-right leading-tight">
          <div className="text-xs text-text-primary">{user.displayName}</div>
          <div className={`text-[10px] ${user.role === "founder" ? "font-medium text-warning" : "text-text-muted"}`}>
            {ROLE_LABELS[user.role]}
          </div>
        </div>
        <LogoutButton />
      </div>
    </header>
  );
}
