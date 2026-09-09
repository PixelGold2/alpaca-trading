import Link from "next/link";

export default function ForgotPasswordPage() {
  return (
    <div className="w-full max-w-sm text-center">
      <div className="rounded-lg border border-border bg-bg-panel p-6 shadow-xl">
        <h1 className="mb-2 text-sm font-medium text-text-primary">Password reset</h1>
        <p className="text-xs text-text-secondary">
          Self-service password reset isn&apos;t enabled yet. Contact your administrator to have
          your password reset.
        </p>
      </div>
      <Link href="/login" className="mt-4 inline-block text-xs text-accent-strong hover:underline">
        Back to sign in
      </Link>
    </div>
  );
}
