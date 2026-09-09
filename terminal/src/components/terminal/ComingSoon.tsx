export function ComingSoon({ feature, phase }: { feature: string; phase: string }) {
  return (
    <div className="flex h-full min-h-[50vh] flex-col items-center justify-center rounded-lg border border-dashed border-border text-center">
      <div className="mb-1 text-sm font-medium text-text-secondary">{feature}</div>
      <p className="text-xs text-text-muted">Not built yet — planned for {phase}.</p>
    </div>
  );
}
