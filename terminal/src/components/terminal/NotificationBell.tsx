"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  link: string | null;
  read: boolean;
  createdAt: string;
}

const POLL_INTERVAL_MS = 30_000;

function BellIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M6 8a6 6 0 0 1 12 0c0 4 1.5 5.5 2 6H4c.5-.5 2-2 2-6Z" />
      <path d="M10 20a2 2 0 0 0 4 0" />
    </svg>
  );
}

function timeAgo(iso: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

async function fetchNotifications(): Promise<{ enabled: boolean; notifications: Notification[] } | null> {
  try {
    const res = await fetch("/api/notifications");
    if (!res.ok) return null;
    const body = await res.json();
    return { enabled: body.enabled, notifications: body.notifications ?? [] };
  } catch {
    return null; // A failed poll just leaves the last-known list — never fabricate data.
  }
}

export function NotificationBell() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    function poll() {
      fetchNotifications().then((result) => {
        if (cancelled || !result) return;
        setEnabled(result.enabled);
        setNotifications(result.notifications);
      });
    }
    poll();
    const id = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  if (!enabled) return null;

  const unreadCount = notifications.filter((n) => !n.read).length;

  async function markRead(id: string) {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
  }

  async function markAllRead() {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ markAll: true }),
    });
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => {
          setOpen((v) => !v);
          fetchNotifications().then((result) => {
            if (result) {
              setEnabled(result.enabled);
              setNotifications(result.notifications);
            }
          });
        }}
        className="relative flex items-center justify-center rounded p-1.5 text-text-secondary transition hover:bg-bg-hover"
        title="Notifications"
      >
        <BellIcon />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-negative px-1 text-[9px] font-medium text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 w-80 rounded-md border border-border-strong bg-bg-panel-raised shadow-xl">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="text-xs font-medium text-text-primary">Notifications</span>
            {unreadCount > 0 && (
              <button onClick={markAllRead} className="text-[10px] text-accent-strong hover:underline">
                Mark all read
              </button>
            )}
          </div>
          <div className="max-h-80 overflow-y-auto">
            {notifications.length === 0 && (
              <div className="p-4 text-center text-xs text-text-muted">No notifications.</div>
            )}
            {notifications.map((n) => {
              const content = (
                <>
                  <div className="mb-0.5 flex items-center gap-1.5">
                    {!n.read && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />}
                    <span className="text-xs font-medium text-text-primary">{n.title}</span>
                  </div>
                  <div className="text-[11px] text-text-secondary">{n.body}</div>
                  <div className="mt-0.5 text-[10px] text-text-muted">{timeAgo(n.createdAt)}</div>
                </>
              );
              const rowClass = `block border-b border-border/50 px-3 py-2 text-left transition hover:bg-bg-hover ${
                n.read ? "" : "bg-accent/5"
              }`;
              return n.link ? (
                <Link key={n.id} href={n.link} onClick={() => markRead(n.id)} className={rowClass}>
                  {content}
                </Link>
              ) : (
                <button key={n.id} onClick={() => markRead(n.id)} className={`w-full ${rowClass}`}>
                  {content}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
