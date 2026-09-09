import { verifySession } from "@/lib/auth/dal";
import { MarketOverviewStrip } from "@/components/terminal/MarketOverviewStrip";
import { MarketsSnapshotPanel } from "@/components/terminal/MarketsSnapshotPanel";
import { QuickNewsList } from "@/components/terminal/QuickNewsList";
import { ChatQuickAccess } from "@/components/terminal/ChatQuickAccess";
import { TodaysEarningsPanel } from "@/components/terminal/TodaysEarningsPanel";

export default async function HomePage() {
  const user = await verifySession();

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-sm font-medium text-text-primary">Welcome, {user.displayName}</h1>
        <p className="text-xs text-text-muted">HOME workspace — customizable workspaces arrive in a later phase.</p>
      </div>

      <MarketOverviewStrip />
      <MarketsSnapshotPanel />
      <ChatQuickAccess />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <QuickNewsList />
        </div>
        <div className="space-y-4">
          <TodaysEarningsPanel />
        </div>
      </div>
    </div>
  );
}
