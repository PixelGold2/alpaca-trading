import Link from "next/link";
import { LoginForm } from "@/components/auth/LoginForm";

export default function LoginPage() {
  return (
    <div className="w-full max-w-sm">
      <div className="mb-8 text-center">
        <p className="mb-3 text-sm font-bold italic text-text-primary">
          The All In One Financial Terminal You Need
        </p>
        <div className="mb-2 font-mono text-2xl font-semibold tracking-tight text-text-primary">
          <span className="text-accent-strong">&gt;</span> TERMINAL
        </div>
        <p className="text-xs text-text-muted">Private research &amp; trading workstation</p>
      </div>

      <div className="rounded-lg border border-border bg-bg-panel p-6 shadow-xl">
        <LoginForm />
      </div>

      <p className="mt-6 text-center text-xs text-text-muted">
        Don&apos;t have an account?{" "}
        <Link href="/register" className="text-accent-strong hover:underline">
          Request access
        </Link>
        . New accounts need admin approval before signing in.
      </p>
    </div>
  );
}
