import { verifySession } from "@/lib/auth/dal";
import { TopBar } from "@/components/terminal/TopBar";
import { Sidebar } from "@/components/terminal/Sidebar";
import { StatusBar } from "@/components/terminal/StatusBar";
import { GlobalTicker } from "@/components/terminal/GlobalTicker";
import { FeedbackWidget } from "@/components/feedback/FeedbackWidget";

export default async function TerminalLayout({ children }: { children: React.ReactNode }) {
  // Defense in depth: proxy.ts already redirected unauthenticated requests away,
  // but every render still verifies against the database here (see lib/auth/dal.ts).
  const user = await verifySession();

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-bg-app">
      <TopBar user={user} />
      <GlobalTicker />
      <div className="flex min-h-0 flex-1">
        <Sidebar role={user.role} />
        <main className="min-w-0 flex-1 overflow-y-auto p-4">{children}</main>
      </div>
      <StatusBar />
      <FeedbackWidget />
    </div>
  );
}
