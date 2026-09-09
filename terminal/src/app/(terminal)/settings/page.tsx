import { verifySession } from "@/lib/auth/dal";
import { query } from "@/lib/db";
import { ChangePasswordForm } from "@/components/settings/ChangePasswordForm";
import { NotificationToggle } from "@/components/settings/NotificationToggle";
import { ProfileForm } from "@/components/settings/ProfileForm";

export default async function SettingsPage() {
  const user = await verifySession();

  const { rows } = await query<{
    notifications_enabled: boolean;
    bio: string | null;
    has_avatar: boolean;
  }>(
    `SELECT notifications_enabled, bio, (avatar_data IS NOT NULL) AS has_avatar FROM users WHERE id = $1`,
    [user.id],
  );

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-sm font-medium text-text-primary">Settings</h1>
        <p className="text-xs text-text-muted">Configure your own account.</p>
      </div>

      <div className="rounded-lg border border-border bg-bg-panel p-4">
        <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-text-secondary">Account</h2>
        <p className="mb-3 text-xs text-text-muted">
          Signed in as {user.displayName} ({user.email}).
        </p>
        <ChangePasswordForm />
      </div>

      <div className="rounded-lg border border-border bg-bg-panel p-4">
        <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-text-secondary">Profile</h2>
        <p className="mb-3 text-xs text-text-muted">
          Your photo and description are visible to other members in Chats.
        </p>
        <ProfileForm
          userId={user.id}
          displayName={user.displayName}
          initialBio={rows[0]?.bio ?? ""}
          initialHasAvatar={rows[0]?.has_avatar ?? false}
        />
      </div>

      <div className="rounded-lg border border-border bg-bg-panel p-4">
        <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-text-secondary">
          Notifications
        </h2>
        <NotificationToggle initialEnabled={rows[0]?.notifications_enabled ?? true} />
      </div>
    </div>
  );
}
