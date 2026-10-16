"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { LoaderCircle, MessageCircle, Trash2 } from "lucide-react";
import { anonymousProfile, saveAnonymousUsername } from "../utils/anonymousProfile";
import { containsLink, MAX_COMMENT_LENGTH } from "@/lib/community/validation";
import { formatTimeAgo } from "@/lib/site";

type Comment = { id: string; profile_name: string; body: string; created_at: string };

function CommentBody({ body }: { body: string }) {
  const [expanded, setExpanded] = useState(false);
  const [isClamped, setIsClamped] = useState(false);
  const textRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const el = textRef.current;
    if (!el) return;
    if (el.scrollHeight > el.clientHeight + 1) {
      setIsClamped(true);
    }
  }, [body]);

  const newlineLines = body.split("\n").length;
  const isLong = newlineLines > 3 || isClamped;

  return (
    <div>
      <p
        ref={textRef}
        className={`mt-1 whitespace-pre-wrap break-words text-sm text-ink-2 ${
          !expanded ? "line-clamp-3" : ""
        }`}
      >
        {body}
      </p>
      {isLong && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="mt-1 inline-block text-xs font-medium text-ink-3 opacity-60 transition-opacity hover:text-ink hover:opacity-100"
        >
          {expanded ? "Show less" : "Read more"}
        </button>
      )}
    </div>
  );
}

export default function VideoComments({ videoId }: { videoId: string }) {
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [myCommentIds, setMyCommentIds] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [posting, setPosting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async (offset = 0) => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/community?videoId=${videoId}&offset=${offset}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setComments((old) => offset
        ? [...old, ...data.comments.filter((comment: Comment) => !old.some((existing) => existing.id === comment.id))]
        : data.comments);
      setMore(data.hasMore);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load comments");
    } finally {
      setBusy(false);
    }
  }, [videoId]);

  useEffect(() => {
    setName(anonymousProfile().name || "");
    try {
      const storedIds = JSON.parse(localStorage.getItem("erobabe-my-comment-ids") || "[]");
      if (Array.isArray(storedIds)) setMyCommentIds(storedIds);
    } catch {}
    void load();
  }, [load]);

  // Grow with the text instead of creating a nested scrolling input.
  useEffect(() => {
    const textarea = composerRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [body]);

  const postComment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (posting || !body.trim()) return;

    if (body.trim().length > MAX_COMMENT_LENGTH) {
      setError(`Comments must be ${MAX_COMMENT_LENGTH} characters or fewer.`);
      return;
    }

    if (containsLink(body)) {
      setError("Links are not allowed in comments.");
      return;
    }

    setPosting(true);
    setError("");
    try {
      const profile = anonymousProfile();
      const res = await fetch("/api/community", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoId, visitorId: profile.id, body: body.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      if (typeof data.name === "string") {
        const savedProfile = saveAnonymousUsername(data.name);
        setName(savedProfile.name || data.name);
      }
      if (typeof data.id === "string") {
        setMyCommentIds((prev) => {
          const updated = [...prev, data.id];
          try {
            localStorage.setItem("erobabe-my-comment-ids", JSON.stringify(updated));
          } catch {}
          return updated;
        });
      }
      setBody("");
      await load();
    } catch (postError) {
      setError(postError instanceof Error ? postError.message : "Unable to comment");
    } finally {
      setPosting(false);
    }
  };

  const deleteComment = async (commentId: string) => {
    if (deletingId) return;
    setDeletingId(commentId);
    setError("");
    try {
      const profile = anonymousProfile();
      const res = await fetch("/api/community", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commentId, visitorId: profile.id, videoId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Unable to delete comment");

      setComments((old) => old.filter((c) => c.id !== commentId));
      setMyCommentIds((prev) => {
        const updated = prev.filter((id) => id !== commentId);
        try {
          localStorage.setItem("erobabe-my-comment-ids", JSON.stringify(updated));
        } catch {}
        return updated;
      });
    } catch (delError) {
      setError(delError instanceof Error ? delError.message : "Unable to delete comment");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <section className="mt-7 pt-5" aria-label="Comments">
      <h2 className="text-[15px] font-semibold">Comments</h2>
      <p className="mt-1 text-xs text-ink-3">Newest first</p>

      {/* Keep long comment threads scrollable without a visible scrollbar. */}
      <div
        aria-label="Comment list"
        className="center-scroll no-scrollbar mt-4 max-h-[300px] overflow-y-auto space-y-4 pr-1"
      >
        {comments.map((comment) => {
          const isOwner = Boolean(
            (name && comment.profile_name.toLowerCase() === name.toLowerCase()) ||
            myCommentIds.includes(comment.id)
          );

          return (
            <article key={comment.id} className="flex gap-3">
              <span
                aria-hidden
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent"
              >
                {comment.profile_name.slice(0, 1)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold">
                    {comment.profile_name}
                    <time className="ml-2 font-normal text-ink-3" dateTime={comment.created_at}>
                      {formatTimeAgo(comment.created_at)}
                    </time>
                  </p>
                  {isOwner && (
                    <button
                      type="button"
                      onClick={() => void deleteComment(comment.id)}
                      disabled={deletingId === comment.id}
                      aria-label="Delete your comment"
                      title="Delete your comment"
                      className="inline-flex items-center gap-1 text-[11px] text-ink-3 opacity-70 transition hover:text-red-400 hover:opacity-100 disabled:opacity-40"
                    >
                      {deletingId === comment.id
                        ? <LoaderCircle className="h-3 w-3 animate-spin" aria-hidden="true" />
                        : <Trash2 className="h-3 w-3" aria-hidden="true" />}
                    </button>
                  )}
                </div>
                <CommentBody body={comment.body} />
              </div>
            </article>
          );
        })}
      </div>

      {!busy && !error && !comments.length && (
        <p className="mt-4 text-sm text-ink-3">Be the first to comment.</p>
      )}
      {busy && <p role="status" className="mt-4 text-sm text-ink-3">Loading comments…</p>}
      {more && !busy && (
        <button
          type="button"
          disabled={posting}
          onClick={() => void load(comments.length)}
          className="mt-4 rounded-full px-3 py-2 text-sm text-ink-2 transition hover:bg-rail hover:text-ink disabled:opacity-50"
        >
          View more
        </button>
      )}
      {error && (
        <p role="alert" className="my-3 text-sm text-red-400">
          {error}{" "}
          <button type="button" onClick={() => void load()} className="underline">Retry</button>
        </p>
      )}

      {/* The comment composer deliberately follows the list, at its bottom. */}
      <form
        onSubmit={postComment}
        className="mt-5"
        aria-label="Post a comment"
      >
        <div className="mb-2 flex items-center justify-between text-xs text-ink-3">
          {name ? <span>Comment anonymously as {name}</span> : <span />}
          <span className={`tabular-nums ${body.length > MAX_COMMENT_LENGTH ? "text-red-400" : ""}`}>
            {body.length}/{MAX_COMMENT_LENGTH}
          </span>
        </div>
        <div className="flex items-end gap-2">
          <textarea
            ref={composerRef}
            aria-label="Your comment"
            required
            maxLength={MAX_COMMENT_LENGTH}
            rows={1}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="Add a comment..."
            className="no-scrollbar min-h-11 max-h-32 min-w-0 flex-1 resize-none overflow-y-auto rounded-3xl border border-line bg-rail px-4 py-3 text-sm leading-5 transition-colors focus:border-accent"
          />
          <button
            type="submit"
            aria-label={posting ? "Posting comment" : "Post comment"}
            title={posting ? "Posting comment…" : "Post comment"}
            disabled={posting || busy || !body.trim() || body.length > MAX_COMMENT_LENGTH}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent text-white transition hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-40"
          >
            {posting
              ? <LoaderCircle aria-hidden="true" className="h-5 w-5 animate-spin" />
              : <MessageCircle aria-hidden="true" className="h-5 w-5" />}
          </button>
        </div>
      </form>
    </section>
  );
}
