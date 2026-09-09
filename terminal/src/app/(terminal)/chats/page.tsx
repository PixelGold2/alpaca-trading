import Link from "next/link";
import { CHAT_CATEGORIES, CHAT_CATEGORY_LABELS, type ChatCategory } from "@/lib/chat/categories";
import { ChatRoom } from "@/components/chat/ChatRoom";

export default async function ChatsPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>;
}) {
  const { category: rawCategory } = await searchParams;
  const category = (CHAT_CATEGORIES.includes(rawCategory as ChatCategory) ? rawCategory : "general") as ChatCategory;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-sm font-medium text-text-primary">Chats</h1>
        <p className="text-xs text-text-muted">Talk shop with everyone else using the terminal, by topic.</p>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-border pb-2">
        {CHAT_CATEGORIES.map((c) => (
          <Link
            key={c}
            href={`/chats?category=${c}`}
            className={`rounded-md px-2.5 py-1 text-xs ${
              category === c ? "bg-accent text-white" : "text-text-secondary hover:bg-bg-hover"
            }`}
          >
            {CHAT_CATEGORY_LABELS[c]}
          </Link>
        ))}
      </div>

      <ChatRoom key={category} category={category} />
    </div>
  );
}
