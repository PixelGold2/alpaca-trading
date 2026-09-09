"use client";

import { useEffect, useState } from "react";

export function ClientClock() {
  // Lazy init runs during the client's own render (not SSR output), so this never
  // needs a synchronous setState-in-effect just to seed an initial value.
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    // The server-rendered time and the client's first render will differ by design —
    // this is a live clock, not stale data. suppressHydrationWarning accepts that for
    // this text node instead of forcing a null-then-hydrate placeholder dance.
    <span className="font-mono text-xs text-text-secondary" suppressHydrationWarning>
      {now.toLocaleTimeString("en-US", {
        hour12: false,
        timeZoneName: "short",
      })}
    </span>
  );
}
