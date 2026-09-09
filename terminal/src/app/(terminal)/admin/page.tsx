import Link from "next/link";
import { requireRole } from "@/lib/auth/dal";
import { query } from "@/lib/db";
import { InviteUserForm } from "@/components/admin/InviteUserForm";
import { UserTable, type AdminUserRow } from "@/components/admin/UserTable";
import { ApprovalTable, type ApprovalRow } from "@/components/admin/ApprovalTable";
import { FeedbackReportsTable, type FeedbackReportRow } from "@/components/admin/FeedbackReportsTable";
import { WhatsNewForm } from "@/components/admin/WhatsNewForm";
import { WhatsNewList, type WhatsNewPostRow } from "@/components/admin/WhatsNewList";

type AdminSection = "approvals" | "invite" | "users" | "feedback" | "whats-new";
const SECTIONS: { value: AdminSection; label: string }[] = [
  { value: "approvals", label: "Account Approvals" },
  { value: "invite", label: "Invite User" },
  { value: "users", label: "Users" },
  { value: "feedback", label: "Feedback & Bug Reports" },
  { value: "whats-new", label: "What's New" },
];

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ section?: string }>;
}) {
  const currentUser = await requireRole("admin");
  const { section: rawSection } = await searchParams;
  const section = (SECTIONS.some((s) => s.value === rawSection) ? rawSection : "approvals") as AdminSection;

  const { rows } = await query<{
    id: string;
    email: string;
    display_name: string;
    role: AdminUserRow["role"];
    is_active: boolean;
    created_at: string;
  }>(
    `SELECT id, email, display_name, role, is_active, created_at FROM users
     WHERE approval_status = 'approved' ORDER BY created_at ASC`,
  );

  const users: AdminUserRow[] = rows.map((r) => ({
    id: r.id,
    email: r.email,
    displayName: r.display_name,
    role: r.role,
    isActive: r.is_active,
    createdAt: r.created_at,
  }));

  const { rows: approvalRows } = await query<{
    id: string;
    first_name: string | null;
    last_name: string | null;
    email: string;
    username: string | null;
    approval_status: ApprovalRow["approvalStatus"];
    created_at: string;
  }>(
    `SELECT id, first_name, last_name, email, username, approval_status, created_at FROM users
     WHERE approval_status != 'approved' ORDER BY created_at DESC`,
  );

  const approvalRequests: ApprovalRow[] = approvalRows.map((r) => ({
    id: r.id,
    firstName: r.first_name,
    lastName: r.last_name,
    email: r.email,
    username: r.username,
    approvalStatus: r.approval_status,
    createdAt: r.created_at,
  }));

  const { rows: feedbackRows } = await query<{
    id: string;
    type: FeedbackReportRow["type"];
    description: string;
    page_url: string | null;
    image_data: Buffer | null;
    image_mime_type: string | null;
    status: FeedbackReportRow["status"];
    submitter_email: string | null;
    created_at: string;
  }>(
    `SELECT f.id, f.type, f.description, f.page_url, f.image_data, f.image_mime_type,
            f.status, u.email AS submitter_email, f.created_at
     FROM feedback_reports f
     LEFT JOIN users u ON u.id = f.submitted_by
     ORDER BY f.created_at DESC`,
  );

  const feedbackReports: FeedbackReportRow[] = feedbackRows.map((r) => ({
    id: r.id,
    type: r.type,
    description: r.description,
    pageUrl: r.page_url,
    imageDataUrl: r.image_data ? `data:${r.image_mime_type};base64,${r.image_data.toString("base64")}` : null,
    status: r.status,
    submitterEmail: r.submitter_email,
    createdAt: r.created_at,
  }));

  const { rows: whatsNewRows } = await query<{
    id: string;
    title: string;
    body: string;
    image_data: Buffer | null;
    image_mime_type: string | null;
    author_name: string | null;
    created_at: string;
  }>(
    `SELECT p.id, p.title, p.body, p.image_data, p.image_mime_type, u.display_name AS author_name, p.created_at
     FROM whats_new_posts p
     LEFT JOIN users u ON u.id = p.created_by
     ORDER BY p.created_at DESC`,
  );

  const whatsNewPosts: WhatsNewPostRow[] = whatsNewRows.map((r) => ({
    id: r.id,
    title: r.title,
    body: r.body,
    imageDataUrl: r.image_data ? `data:${r.image_mime_type};base64,${r.image_data.toString("base64")}` : null,
    authorName: r.author_name,
    createdAt: r.created_at,
  }));

  const pendingCount = approvalRequests.filter((r) => r.approvalStatus === "pending").length;
  const openFeedbackCount = feedbackReports.filter((r) => r.status === "open").length;

  const SECTION_BADGES: Partial<Record<AdminSection, number>> = {
    approvals: pendingCount,
    feedback: openFeedbackCount,
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-sm font-medium text-text-primary">Admin</h1>
        <p className="text-xs text-text-muted">
          Invite-only access, plus self-registration requests, feedback triage, and What&apos;s New posts.
          Full admin dashboard (sessions, system health, provider status) arrives in a later phase.
        </p>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-border pb-2">
        {SECTIONS.map((s) => {
          const badge = SECTION_BADGES[s.value];
          return (
            <Link
              key={s.value}
              href={`/admin?section=${s.value}`}
              className={`rounded-md px-2.5 py-1 text-xs ${
                section === s.value ? "bg-accent text-white" : "text-text-secondary hover:bg-bg-hover"
              }`}
            >
              {s.label}
              {!!badge && <span className="ml-1.5 opacity-80">({badge})</span>}
            </Link>
          );
        })}
      </div>

      {section === "approvals" && (
        <div className="rounded-lg border border-border bg-bg-panel p-4">
          <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-text-secondary">
            Account approvals ({pendingCount} pending)
          </h2>
          <ApprovalTable requests={approvalRequests} />
        </div>
      )}

      {section === "invite" && (
        <div className="rounded-lg border border-border bg-bg-panel p-4">
          <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-text-secondary">Invite user</h2>
          <InviteUserForm />
        </div>
      )}

      {section === "users" && (
        <div className="rounded-lg border border-border bg-bg-panel p-4">
          <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-text-secondary">
            Users ({users.length})
          </h2>
          <UserTable users={users} currentUserId={currentUser.id} currentUserRole={currentUser.role} />
        </div>
      )}

      {section === "feedback" && (
        <div className="rounded-lg border border-border bg-bg-panel p-4">
          <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-text-secondary">
            Feedback &amp; bug reports ({openFeedbackCount} open)
          </h2>
          <FeedbackReportsTable reports={feedbackReports} />
        </div>
      )}

      {section === "whats-new" && (
        <div className="space-y-4">
          <div className="rounded-lg border border-border bg-bg-panel p-4">
            <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-text-secondary">
              Post an update
            </h2>
            <WhatsNewForm />
          </div>
          <div className="rounded-lg border border-border bg-bg-panel p-4">
            <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-text-secondary">
              Published posts ({whatsNewPosts.length})
            </h2>
            <WhatsNewList posts={whatsNewPosts} />
          </div>
        </div>
      )}
    </div>
  );
}
