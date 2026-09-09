"use client";

import { linkify } from "@/lib/chat/linkify";
import type { ChatMessageRow } from "@/app/api/chat/messages/route";
import { Avatar } from "@/components/ui/Avatar";
import { RoleBadge } from "@/components/ui/RoleBadge";
import { InspectableImage } from "@/components/ui/InspectableImage";
import { UserProfilePopover } from "@/components/chat/UserProfilePopover";

function timeAgo(iso: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function ChatMessage({ message }: { message: ChatMessageRow }) {
  return (
    <div className="flex gap-2 py-1.5">
      <UserProfilePopover userId={message.senderId} triggerClassName="mt-0.5">
        <Avatar userId={message.senderId} name={message.senderName} hasAvatar={message.senderHasAvatar} size={28} />
      </UserProfilePopover>

      <div className="min-w-0 flex-1">
        <div className="mb-0.5 flex items-baseline gap-2">
          <UserProfilePopover userId={message.senderId}>
            <span className="text-xs font-medium text-text-primary hover:underline">{message.senderName}</span>
          </UserProfilePopover>
          <RoleBadge role={message.senderRole} />
          <span className="text-[10px] text-text-muted">{timeAgo(message.createdAt)}</span>
        </div>

        {message.body && (
          <p className="whitespace-pre-wrap break-words text-xs text-text-secondary">
            {linkify(message.body).map((segment, i) =>
              segment.isLink ? (
                <a
                  key={i}
                  href={segment.text}
                  target="_blank"
                  rel="noreferrer"
                  className="text-accent-strong hover:underline"
                >
                  {segment.text}
                </a>
              ) : (
                <span key={i}>{segment.text}</span>
              ),
            )}
          </p>
        )}

        {message.imageDataUrl && (
          <InspectableImage
            src={message.imageDataUrl}
            className="mt-1.5 max-h-64 max-w-xs rounded border border-border object-contain"
          />
        )}
      </div>
    </div>
  );
}
