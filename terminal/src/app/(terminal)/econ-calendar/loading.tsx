// FRED's bulk release-dates call (see fred-econ-calendar.ts) can take a
// while under contention with this app's background collectors — without
// this, the page would just sit blank while the server component awaits
// data, which is exactly what "the page isn't opening" looks like from the
// outside. Next's file-based loading.tsx wraps the page in a Suspense
// boundary automatically, so this shows immediately while data loads.
export default function EconCalendarLoading() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-sm font-medium text-text-primary">Economic Calendar</h1>
        <p className="text-xs text-text-muted">Loading release data from FRED…</p>
      </div>
      <div className="flex h-40 items-center justify-center rounded-lg border border-dashed border-border">
        <span className="text-xs text-text-muted">This can take a few seconds.</span>
      </div>
    </div>
  );
}
