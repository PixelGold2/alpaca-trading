import { verifySession } from "@/lib/auth/dal";
import { getRecentEvents, getEventsSince } from "@/lib/world-tracker/events-store";
import { getUpcomingEarningsEvents } from "@/lib/world-tracker/earnings-provider";
import type { WorldEvent } from "@/lib/world-tracker/types";
import type { ProviderMeta } from "@/lib/providers/types";

export const dynamic = "force-dynamic";

const POLL_INTERVAL_MS = 20_000;

// Server-Sent Events stream. Sends the current batch of events on connect
// (real GDELT-derived events from Postgres, collected in the background by
// instrumentation.ts / the /api/world-tracker/collect endpoint — see those
// files — plus real upcoming earnings), then any newly-collected rows every
// ~20s. No mock/fake data — an empty result while the collector hasn't found
// anything yet is shown as-is, never backfilled with placeholder events.
export async function GET() {
  await verifySession();

  const encoder = new TextEncoder();
  let interval: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      let cursor = new Date();

      try {
        const [collected, earnings] = await Promise.all([getRecentEvents(), getUpcomingEarningsEvents()]);
        const combined: WorldEvent[] = [...collected, ...(earnings.data ?? [])];
        const meta: ProviderMeta = { provider: "gdelt", timestamp: new Date().toISOString(), status: "live" };
        send("batch", { data: combined, meta });
      } catch (err) {
        const meta: ProviderMeta = {
          provider: "gdelt",
          timestamp: new Date().toISOString(),
          status: "error",
          message: err instanceof Error ? err.message : "Failed to load events.",
        };
        send("batch", { data: null, meta });
      }

      interval = setInterval(async () => {
        try {
          const newEvents = await getEventsSince(cursor);
          cursor = new Date();
          for (const event of newEvents) {
            send("event", { data: event, meta: { provider: "gdelt", timestamp: new Date().toISOString(), status: "live" } });
          }
        } catch {
          // A transient DB hiccup just means this tick surfaces nothing new —
          // the next tick tries again with the same cursor.
        }
      }, POLL_INTERVAL_MS);
    },
    cancel() {
      if (interval) clearInterval(interval);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
