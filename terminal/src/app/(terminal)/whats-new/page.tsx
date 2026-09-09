import { verifySession } from "@/lib/auth/dal";
import { query } from "@/lib/db";
import { InspectableImage } from "@/components/ui/InspectableImage";

export default async function WhatsNewPage() {
  await verifySession();

  const { rows } = await query<{
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
     ORDER BY p.created_at DESC
     LIMIT 50`,
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-sm font-medium text-text-primary">What&apos;s New</h1>
        <p className="text-xs text-text-muted">Recent updates to the terminal, posted by admins.</p>
      </div>

      {rows.length === 0 ? (
        <p className="text-xs text-text-muted">Nothing posted yet — check back soon.</p>
      ) : (
        <div className="space-y-3">
          {rows.map((post) => (
            <article key={post.id} className="rounded-lg border border-border bg-bg-panel p-4">
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-sm font-semibold text-text-primary">{post.title}</h2>
                <span className="text-[10px] text-text-muted">
                  {post.author_name ?? "Admin"} &middot; {new Date(post.created_at).toLocaleString()}
                </span>
              </div>
              <p className="whitespace-pre-wrap text-xs text-text-secondary">{post.body}</p>
              {post.image_data && (
                <InspectableImage
                  src={`data:${post.image_mime_type};base64,${post.image_data.toString("base64")}`}
                  className="mt-3 max-h-96 rounded-md border border-border"
                />
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
