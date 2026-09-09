// Shared by server and client components — no "server-only" import.

const ONLINE_WINDOW_MS = 2 * 60 * 1000;
const LAST_SEEN_WINDOW_MS = 45 * 60 * 1000;

export interface Presence {
  online: boolean;
  label: string;
}

export function getPresence(lastSeenAt: string | null): Presence {
  if (!lastSeenAt) return { online: false, label: "Offline" };

  const diffMs = Date.now() - new Date(lastSeenAt).getTime();
  if (diffMs <= ONLINE_WINDOW_MS) return { online: true, label: "Online" };
  if (diffMs <= LAST_SEEN_WINDOW_MS) {
    const minutes = Math.max(1, Math.round(diffMs / 60_000));
    return { online: false, label: `Last seen ${minutes}m ago` };
  }
  return { online: false, label: "Offline" };
}
