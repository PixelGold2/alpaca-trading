"use client";

import { deleteWhatsNewPost } from "@/app/actions/whats-new";
import { ConfirmButton } from "@/components/ui/ConfirmButton";
import { InspectableImage } from "@/components/ui/InspectableImage";

export interface WhatsNewPostRow {
  id: string;
  title: string;
  body: string;
  imageDataUrl: string | null;
  authorName: string | null;
  createdAt: string;
}

export function WhatsNewList({ posts }: { posts: WhatsNewPostRow[] }) {
  if (posts.length === 0) {
    return <p className="text-xs text-text-muted">No posts yet.</p>;
  }

  return (
    <div className="space-y-2">
      {posts.map((post) => (
        <div key={post.id} className="rounded-md border border-border bg-bg-panel-raised p-3">
          <div className="mb-1 flex items-start justify-between gap-2">
            <div>
              <h3 className="text-xs font-medium text-text-primary">{post.title}</h3>
              <span className="text-[10px] text-text-muted">
                {post.authorName ?? "Unknown admin"} &middot; {new Date(post.createdAt).toLocaleString()}
              </span>
            </div>
            <ConfirmButton
              label="Delete"
              variant="danger"
              confirmText={`Delete "${post.title}"? This can't be undone.`}
              onConfirm={() => deleteWhatsNewPost(post.id)}
            />
          </div>
          <p className="whitespace-pre-wrap text-xs text-text-secondary">{post.body}</p>
          {post.imageDataUrl && (
            <InspectableImage src={post.imageDataUrl} className="mt-2 max-h-32 rounded border border-border" />
          )}
        </div>
      ))}
    </div>
  );
}
