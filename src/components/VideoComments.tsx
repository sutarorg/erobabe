"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { LoaderCircle, MessageCircle } from "lucide-react";
import { anonymousProfile, saveAnonymousUsername } from "../utils/anonymousProfile";

type Comment = { id: string; profile_name: string; body: string; created_at: string };

export default function VideoComments({ videoId }: { videoId: string }) {
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [posting, setPosting] = useState(false);
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

    setPosting(true);
    setError("");
    try {
      const profile = anonymousProfile();
      const res = await fetch("/api/community", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // The server creates a username from the local word library on the first comment and returns
        // the assigned name; clients cannot choose or reuse someone else's.
        body: JSON.stringify({ videoId, visitorId: profile.id, body }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      if (typeof data.name === "string") {
        const savedProfile = saveAnonymousUsername(data.name);
        setName(savedProfile.name || data.name);
      }
      setBody("");
      await load();
    } catch (postError) {
      setError(postError instanceof Error ? postError.message : "Unable to comment");
    } finally {
      setPosting(false);
    }
  };

  return (
    <section className="mt-7 pt-5" aria-label="Comments">
      <h2 className="text-[15px] font-semibold">Comments</h2>
      <p className="mt-1 text-xs text-ink-3">Newest first</p>

      <div aria-label="Comment list" className="no-scrollbar mt-4 space-y-4">
        {comments.map((comment) => (
          <article key={comment.id} className="flex gap-3">
            <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
              {comment.profile_name.slice(0, 1)}
            </span>
            <div className="min-w-0">
              <p className="text-xs font-semibold">
                {comment.profile_name}
                <time className="ml-2 font-normal text-ink-3" dateTime={comment.created_at}>
                  {new Date(comment.created_at).toLocaleDateString()}
                </time>
              </p>
              <p className="mt-1 whitespace-pre-wrap break-words text-sm text-ink-2">{comment.body}</p>
            </div>
          </article>
        ))}
      </div>

      {!busy && !error && !comments.length && (
        <p className="mt-4 text-sm text-ink-3">Be the first to comment.</p>
      )}
      {busy && <p role="status" className="mt-4 text-sm text-ink-3">Loading comments…</p>}
      {more && (
        <button
          type="button"
          disabled={busy || posting}
          onClick={() => void load(comments.length)}
          className="mt-4 rounded-full px-3 py-2 text-sm text-ink-2 transition hover:bg-rail hover:text-ink disabled:opacity-50"
        >
          View more · 5 comments
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
        {name && <p className="mb-2 text-xs text-ink-3">Comment anonymously as {name}</p>}
        <div className="flex items-end gap-2">
          <textarea
            ref={composerRef}
            aria-label="Your comment"
            required
            maxLength={1000}
            rows={1}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="Add a comment…"
            className="no-scrollbar min-h-11 min-w-0 flex-1 resize-none overflow-hidden rounded-3xl border border-line bg-rail px-4 py-3 text-sm leading-5 transition-colors focus:border-accent"
          />
          <button
            type="submit"
            aria-label={posting ? "Posting comment" : "Post comment"}
            title={posting ? "Posting comment…" : "Post comment"}
            disabled={posting || busy || !body.trim()}
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
