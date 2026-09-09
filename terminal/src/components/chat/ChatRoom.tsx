"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { sendChatMessage, type SendMessageState } from "@/app/actions/chat";
import type { ChatCategory } from "@/lib/chat/categories";
import type { ChatMessageRow } from "@/app/api/chat/messages/route";
import { ChatMessage } from "@/components/chat/ChatMessage";

const POLL_MS = 4000;
const NEAR_BOTTOM_PX = 80;

const initialState: SendMessageState = {};

// Pure fetch, no state access — setting state happens in a `.then` callback
// in the effects below, matching NotificationBell.tsx's polling pattern.
async function loadMessages(category: ChatCategory): Promise<ChatMessageRow[] | null> {
  try {
    const res = await fetch(`/api/chat/messages?category=${category}`);
    if (!res.ok) return null;
    const body: { messages: ChatMessageRow[] } = await res.json();
    return body.messages ?? [];
  } catch {
    return null; // Transient poll failure — the next tick retries; don't clear what's already shown.
  }
}

export function ChatRoom({ category }: { category: ChatCategory }) {
  const [messages, setMessages] = useState<ChatMessageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [atBottom, setAtBottom] = useState(true);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  const [state, formAction, pending] = useActionState(sendChatMessage, initialState);

  // Start polling as soon as this instance mounts. The parent page remounts
  // this component with a fresh `key={category}` on category change, so the
  // initial useState values already give us a clean slate — no reset needed.
  useEffect(() => {
    let cancelled = false;
    function poll() {
      loadMessages(category).then((result) => {
        if (cancelled || !result) return;
        setMessages(result);
        setLoading(false);
      });
    }
    poll();
    const interval = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [category]);

  // Auto-scroll to the newest message only if the reader was already at the
  // bottom — otherwise leave their scroll position alone and let the "Jump to
  // chat" button surface instead.
  useEffect(() => {
    if (atBottomRef.current) bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  // Clear the image preview the moment a submission succeeds — "adjust state
  // during render" (react.dev) instead of an effect, same pattern as
  // WhatsNewForm.tsx. Only pure state updates belong here; DOM/ref actions and
  // re-fetching go in the effect below.
  const [prevState, setPrevState] = useState(state);
  if (state !== prevState) {
    setPrevState(state);
    if (state.success && imagePreview) {
      URL.revokeObjectURL(imagePreview);
      setImagePreview(null);
    }
  }

  // formRef.current?.reset() is a DOM action, and re-polling reacts to the
  // server action's result (an external system) — both stay in an effect.
  useEffect(() => {
    if (!state.success) return;
    formRef.current?.reset();
    atBottomRef.current = true;
    loadMessages(category).then((result) => {
      if (result) setMessages(result);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.success]);

  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
    atBottomRef.current = nearBottom;
    setAtBottom(nearBottom);
  }

  function jumpToChat() {
    bottomRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
    atBottomRef.current = true;
    setAtBottom(true);
  }

  function handleImageChange(file: File | null) {
    setImagePreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return file ? URL.createObjectURL(file) : null;
    });
    if (!file && fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <div className="relative flex h-[600px] flex-col rounded-lg border border-border bg-bg-panel">
      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto px-3 py-2">
        {loading ? (
          <p className="py-4 text-center text-xs text-text-muted">Loading…</p>
        ) : messages.length === 0 ? (
          <p className="py-4 text-center text-xs text-text-muted">No messages yet — say hello.</p>
        ) : (
          <div className="divide-y divide-border/50">
            {messages.map((m) => (
              <ChatMessage key={m.id} message={m} />
            ))}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {!atBottom && (
        <div className="pointer-events-none absolute inset-x-0 bottom-20 flex justify-center">
          <button
            onClick={jumpToChat}
            className="pointer-events-auto rounded-full bg-accent px-3 py-1.5 text-[11px] font-medium text-white shadow-lg hover:bg-accent-strong"
          >
            Jump to chat ↓
          </button>
        </div>
      )}

      <form
        ref={formRef}
        action={formAction}
        className="flex items-end gap-2 border-t border-border p-2"
      >
        <input type="hidden" name="category" value={category} />
        <div className="flex-1 space-y-1.5">
          <textarea
            name="body"
            rows={1}
            disabled={pending}
            placeholder="Message this category…"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                formRef.current?.requestSubmit();
              }
            }}
            className="w-full resize-none rounded-md border border-border bg-bg-panel-raised px-2.5 py-1.5 text-xs text-text-primary outline-none focus:border-accent"
          />
          {imagePreview && (
            <div className="relative inline-block">
              {/* eslint-disable-next-line @next/next/no-img-element -- transient client-side object URL preview, not an optimizable static asset */}
              <img src={imagePreview} alt="Attachment preview" className="max-h-20 rounded border border-border" />
              <button
                type="button"
                onClick={() => handleImageChange(null)}
                className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-negative text-[10px] text-white"
                title="Remove"
              >
                ✕
              </button>
            </div>
          )}
          {state.error && <p className="text-[11px] text-negative">{state.error}</p>}
        </div>

        <label
          title="Attach an image"
          className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-md border border-border text-text-secondary hover:bg-bg-hover"
        >
          📷
          <input
            ref={fileInputRef}
            type="file"
            name="image"
            accept="image/*"
            disabled={pending}
            onChange={(e) => handleImageChange(e.target.files?.[0] ?? null)}
            className="hidden"
          />
        </label>

        <button
          type="submit"
          disabled={pending}
          className="h-8 shrink-0 rounded-md bg-accent px-3 text-xs font-medium text-white hover:bg-accent-strong disabled:opacity-60"
        >
          {pending ? "…" : "Send"}
        </button>
      </form>
    </div>
  );
}
