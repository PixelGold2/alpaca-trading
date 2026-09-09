import { verifySession } from "@/lib/auth/dal";
import { TopBar } from "@/components/terminal/TopBar";
import { Sidebar } from "@/components/terminal/Sidebar";
import { StatusBar } from "@/components/terminal/StatusBar";
import { GlobalTicker } from "@/components/terminal/GlobalTicker";
import { FeedbackWidget } from "@/components/feedback/FeedbackWidget";

// Sibling to (terminal)'s layout, reusing the same chrome components, but
// intentionally omitting RightPanel: the World Tracker supplies its own
// full-width map/feed/YouTube/ticker grid instead of the generic stub column.
export default async function WorldTrackerLayout({ children }: { children: React.ReactNode }) {
  const user = await verifySession();

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-bg-app">
      <TopBar user={user} />
      <GlobalTicker />
      <div className="flex min-h-0 flex-1">
        <Sidebar role={user.role} />
        <main className="min-w-0 flex-1 overflow-hidden p-3">{children}</main>
      </div>
      <StatusBar />
      <FeedbackWidget />
    </div>
  );
}
