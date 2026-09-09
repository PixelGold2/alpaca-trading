"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { RoleBadge } from "@/components/ui/RoleBadge";
import { getPresence } from "@/lib/presence";
import type { UserProfileResponse } from "@/app/api/users/[id]/profile/route";

export function UserProfilePopover({
  userId,
  children,
  triggerClassName = "",
}: {
  userId: string;
  children: ReactNode;
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [profile, setProfile] = useState<UserProfileResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  function toggle() {
    setOpen((wasOpen) => {
      const next = !wasOpen;
      if (next) {
        setLoading(true);
        fetch(`/api/users/${userId}/profile`)
          .then((res) => (res.ok ? (res.json() as Promise<UserProfileResponse>) : null))
          .then((data) => setProfile(data))
          .finally(() => setLoading(false));
      }
      return next;
    });
  }

  return (
    <div className="relative inline-block" ref={containerRef}>
      <button type="button" onClick={toggle} className={`cursor-pointer text-left ${triggerClassName}`}>
        {children}
      </button>

      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-64 rounded-md border border-border-strong bg-bg-panel-raised p-3 shadow-xl">
          {loading && !profile ? (
            <p className="text-xs text-text-muted">Loading…</p>
          ) : profile ? (
            <ProfileCardBody profile={profile} />
          ) : (
            <p className="text-xs text-text-muted">Couldn&apos;t load profile.</p>
          )}
        </div>
      )}
    </div>
  );
}

function ProfileCardBody({ profile }: { profile: UserProfileResponse }) {
  const presence = getPresence(profile.lastSeenAt);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2.5">
        <Avatar userId={profile.id} name={profile.displayName} hasAvatar={profile.hasAvatar} size={40} />
        <div className="min-w-0">
          <div className="truncate text-xs font-medium text-text-primary">{profile.displayName}</div>
          <RoleBadge role={profile.role} />
        </div>
      </div>

      <div className="flex items-center gap-1.5 text-[11px]">
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${presence.online ? "bg-positive" : "bg-text-muted"}`} />
        <span className={presence.online ? "text-positive" : "text-text-muted"}>{presence.label}</span>
      </div>

      <p className="whitespace-pre-wrap break-words text-[11px] text-text-secondary">
        {profile.bio || <span className="text-text-muted">No description set.</span>}
      </p>
    </div>
  );
}
