import Link from "next/link";
import { RegisterForm } from "@/components/auth/RegisterForm";

export default function RegisterPage() {
  return (
    <div className="w-full max-w-sm">
      <div className="mb-8 text-center">
        <div className="mb-2 font-mono text-2xl font-semibold tracking-tight text-text-primary">
          <span className="text-accent-strong">&gt;</span> TERMINAL
        </div>
        <p className="text-xs text-text-muted">Request access to the workstation</p>
      </div>

      <div className="rounded-lg border border-border bg-bg-panel p-6 shadow-xl">
        <RegisterForm />
      </div>

      <p className="mt-6 text-center text-xs text-text-muted">
        Already have an account?{" "}
        <Link href="/login" className="text-accent-strong hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
