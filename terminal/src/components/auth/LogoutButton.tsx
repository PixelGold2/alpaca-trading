import { logout } from "@/app/actions/auth";

export function LogoutButton() {
  return (
    <form action={logout}>
      <button
        type="submit"
        className="rounded px-2 py-1 text-xs text-text-secondary transition hover:bg-bg-hover hover:text-text-primary"
      >
        Log out
      </button>
    </form>
  );
}
