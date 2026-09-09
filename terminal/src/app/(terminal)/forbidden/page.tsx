export default function ForbiddenPage() {
  return (
    <div className="flex h-full min-h-[50vh] flex-col items-center justify-center rounded-lg border border-negative/30 bg-negative/5 text-center">
      <div className="mb-1 text-sm font-medium text-negative">403 — Not authorized</div>
      <p className="text-xs text-text-muted">Your role doesn&apos;t have access to this section.</p>
    </div>
  );
}
