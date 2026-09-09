"use client";

import { useRouter } from "next/navigation";
import { TickerCombobox } from "@/components/terminal/chart/TickerCombobox";

export function EarningsSymbolSearch({ initialSymbol }: { initialSymbol: string }) {
  const router = useRouter();

  return (
    <TickerCombobox
      initialSymbol={initialSymbol}
      onSelect={(symbol) => router.push(`/earnings?symbol=${encodeURIComponent(symbol)}`)}
    />
  );
}
