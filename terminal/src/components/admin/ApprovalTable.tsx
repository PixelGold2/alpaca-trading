"use client";

import { approveRegistrationRequest, rejectRegistrationRequest } from "@/app/actions/admin";
import { ConfirmButton } from "@/components/ui/ConfirmButton";

export interface ApprovalRow {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
  username: string | null;
  approvalStatus: "pending" | "rejected";
  createdAt: string;
}

const STATUS_STYLES: Record<ApprovalRow["approvalStatus"], string> = {
  pending: "text-attention",
  rejected: "text-negative",
};

export function ApprovalTable({ requests }: { requests: ApprovalRow[] }) {
  if (requests.length === 0) {
    return <p className="text-xs text-text-muted">No pending or rejected registration requests.</p>;
  }

  return (
    <table className="w-full text-left text-xs">
      <thead>
        <tr className="border-b border-border text-text-muted">
          <th className="py-2 font-medium">First name</th>
          <th className="py-2 font-medium">Last name</th>
          <th className="py-2 font-medium">Email</th>
          <th className="py-2 font-medium">Username</th>
          <th className="py-2 font-medium">Status</th>
          <th className="py-2 font-medium">Requested</th>
          <th className="py-2 font-medium">Actions</th>
        </tr>
      </thead>
      <tbody>
        {requests.map((r) => (
          <tr key={r.id} className="border-b border-border/50">
            <td className="py-2 text-text-primary">{r.firstName ?? "—"}</td>
            <td className="py-2 text-text-primary">{r.lastName ?? "—"}</td>
            <td className="py-2 text-text-secondary">{r.email}</td>
            <td className="py-2 text-text-secondary">{r.username ?? "—"}</td>
            <td className={`py-2 font-medium uppercase tracking-wide ${STATUS_STYLES[r.approvalStatus]}`}>
              {r.approvalStatus}
            </td>
            <td className="py-2 text-text-muted">{new Date(r.createdAt).toLocaleDateString("en-US")}</td>
            <td className="py-2">
              <div className="flex gap-1.5">
                <ConfirmButton
                  label="Approve"
                  confirmText={`Approve access for ${r.email}?`}
                  onConfirm={() => approveRegistrationRequest(r.id)}
                />
                <ConfirmButton
                  label="Unapprove"
                  variant="danger"
                  confirmText={`Reject the request from ${r.email}?`}
                  onConfirm={() => rejectRegistrationRequest(r.id)}
                />
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
