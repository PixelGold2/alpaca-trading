"use client";

import { useActionState, useRef, useState } from "react";
import { updateProfile, type UpdateProfileState } from "@/app/actions/profile";
import { Avatar } from "@/components/ui/Avatar";

const initialState: UpdateProfileState = {};

export function ProfileForm({
  userId,
  displayName,
  initialBio,
  initialHasAvatar,
}: {
  userId: string;
  displayName: string;
  initialBio: string;
  initialHasAvatar: boolean;
}) {
  const [state, formAction, pending] = useActionState(updateProfile, initialState);
  const [bio, setBio] = useState(initialBio);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [hasAvatar, setHasAvatar] = useState(initialHasAvatar);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // "adjust state during render" (react.dev) instead of an effect, same
  // pattern as WhatsNewForm.tsx. The server reports what it actually did
  // (state.avatarChanged) so this stays a pure state read — no ref needed.
  const [prevState, setPrevState] = useState(state);
  if (state !== prevState) {
    setPrevState(state);
    if (state.success) {
      if (state.avatarChanged === "set") setHasAvatar(true);
      if (state.avatarChanged === "removed") setHasAvatar(false);
      if (imagePreview) URL.revokeObjectURL(imagePreview);
      setImagePreview(null);
    }
  }

  function handleImageChange(file: File | null) {
    setImagePreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return file ? URL.createObjectURL(file) : null;
    });
  }

  function handleRemovePhoto() {
    handleImageChange(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    const fd = new FormData();
    fd.set("bio", bio);
    fd.set("removeAvatar", "true");
    formAction(fd);
  }

  return (
    <form action={formAction} className="space-y-3">
      <div className="flex items-center gap-3">
        {imagePreview ? (
          // eslint-disable-next-line @next/next/no-img-element -- transient client-side object URL preview, not an optimizable static asset
          <img src={imagePreview} alt="" className="h-14 w-14 rounded-full border border-border object-cover" />
        ) : (
          <Avatar userId={userId} name={displayName} hasAvatar={hasAvatar} size={56} />
        )}
        <div className="space-y-1">
          <label className="inline-block cursor-pointer rounded-md border border-border bg-bg-panel px-2.5 py-1 text-[11px] text-text-secondary hover:bg-bg-hover">
            Change photo
            <input
              ref={fileInputRef}
              type="file"
              name="avatar"
              accept="image/*"
              disabled={pending}
              onChange={(e) => handleImageChange(e.target.files?.[0] ?? null)}
              className="hidden"
            />
          </label>
          {hasAvatar && (
            <button
              type="button"
              onClick={handleRemovePhoto}
              disabled={pending}
              className="block text-[11px] text-negative hover:underline"
            >
              Remove photo
            </button>
          )}
        </div>
      </div>

      <div>
        <label className="mb-1 block text-[10px] text-text-muted">Description</label>
        <textarea
          name="bio"
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          disabled={pending}
          rows={3}
          maxLength={280}
          placeholder="Say a bit about yourself…"
          className="w-full resize-none rounded-md border border-border bg-bg-panel px-2.5 py-2 text-xs text-text-primary outline-none focus:border-accent"
        />
      </div>

      {state.error && <p className="text-[11px] text-negative">{state.error}</p>}
      {state.success && <p className="text-[11px] text-positive">Profile updated.</p>}

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-strong disabled:opacity-60"
      >
        {pending ? "Saving..." : "Save profile"}
      </button>
    </form>
  );
}
