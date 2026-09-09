"use client";

import { useRef, useTransition } from "react";

/** A button that confirms via a native <dialog> before firing its action — guards
 * against misclicks on approve/reject/disable-style actions. */
export function ConfirmButton({
  label,
  confirmText = "Are you sure?",
  variant = "default",
  disabled,
  onConfirm,
  className = "",
}: {
  label: string;
  confirmText?: string;
  variant?: "default" | "danger";
  disabled?: boolean;
  onConfirm: () => void | Promise<void>;
  className?: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <>
      <button
        type="button"
        disabled={disabled || isPending}
        onClick={() => dialogRef.current?.showModal()}
        className={`rounded px-2 py-1 text-[11px] font-medium transition disabled:opacity-50 ${
          variant === "danger"
            ? "border border-negative/30 bg-negative/10 text-negative hover:bg-negative/20"
            : "border border-accent/30 bg-accent/10 text-accent-strong hover:bg-accent/20"
        } ${className}`}
      >
        {isPending ? "..." : label}
      </button>

      <dialog
        ref={dialogRef}
        className="rounded-lg border border-border-strong bg-bg-panel-raised p-4 text-text-primary backdrop:bg-black/50"
      >
        <p className="mb-3 text-xs">{confirmText}</p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => dialogRef.current?.close()}
            className="rounded px-2.5 py-1 text-[11px] text-text-secondary hover:bg-bg-hover"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              dialogRef.current?.close();
              startTransition(() => onConfirm());
            }}
            className={`rounded px-2.5 py-1 text-[11px] font-medium text-white ${
              variant === "danger" ? "bg-negative hover:bg-negative/90" : "bg-accent hover:bg-accent-strong"
            }`}
          >
            Confirm
          </button>
        </div>
      </dialog>
    </>
  );
}
