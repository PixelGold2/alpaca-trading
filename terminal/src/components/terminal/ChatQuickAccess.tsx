import Link from "next/link";
import { CHAT_CATEGORIES, CHAT_CATEGORY_LABELS } from "@/lib/chat/categories";

export function ChatQuickAccess() {
  return (
    <div className="rounded-lg border border-border bg-bg-panel p-4">
      <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-text-secondary">Chats</h2>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {CHAT_CATEGORIES.map((c) => (
          <Link
            key={c}
            href={`/chats?category=${c}`}
            className="flex items-center justify-between rounded-md border border-border bg-bg-panel-raised px-3 py-2 text-xs transition hover:border-border-strong"
          >
            <span className="text-text-primary">{CHAT_CATEGORY_LABELS[c]}</span>
            <span className="text-[10px] font-medium text-accent-strong">Jump to chat →</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
