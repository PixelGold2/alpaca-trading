"use client";

import { useState, useTransition } from "react";
import { setNotificationsEnabled } from "@/app/actions/settings";

export function NotificationToggle({ initialEnabled }: { initialEnabled: boolean }) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [isPending, startTransition] = useTransition();

  return (
    <label className="flex max-w-sm items-center justify-between rounded-md border border-border bg-bg-panel-raised px-3 py-2.5">
      <div>
        <div className="text-xs text-text-primary">Notification bell</div>
        <div className="text-[11px] text-text-muted">
          Show alerts in the top bar (e.g. new account requests for admins).
        </div>
      </div>
      <input
        type="checkbox"
        checked={enabled}
        disabled={isPending}
        onChange={(e) => {
          const next = e.target.checked;
          setEnabled(next);
          startTransition(() => setNotificationsEnabled(next));
        }}
        className="h-4 w-4 shrink-0 rounded border-border-strong bg-bg-panel accent-accent"
      />
    </label>
  );
}
