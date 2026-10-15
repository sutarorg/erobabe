"use client";
import { useCallback, useEffect, useState } from "react";
import { anonymousProfile } from "../utils/anonymousProfile";
type Comment = { id: string; profile_name: string; body: string; created_at: string };
export default function VideoComments({ videoId }: { videoId: string }) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async (offset = 0) => {
    setBusy(true); setError("");
    try {
      const res = await fetch(`/api/community?videoId=${videoId}&offset=${offset}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setComments(old => offset ? [...old, ...data.comments.filter((c: Comment) => !old.some(o => o.id === c.id))] : data.comments);
      setMore(data.hasMore);
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to load comments"); }
    finally { setBusy(false); }
  }, [videoId]);
  useEffect(() => { setName(anonymousProfile().name); void load(); }, [load]);
  return <section className="mt-7 border-t border-line pt-5" aria-label="Comments">
    <h2 className="text-[15px] font-semibold">Comments</h2>
    <p className="mt-1 text-xs text-ink-3">Newest first · Comment anonymously as {name || "…"}</p>
    <form className="my-4 flex flex-col gap-2 sm:flex-row" onSubmit={async e => {
      e.preventDefault(); if (posting || !body.trim()) return;
      setPosting(true); setError("");
      try {
        const profile = anonymousProfile();
        const res = await fetch("/api/community", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ videoId, visitorId: profile.id, name: profile.name, body }) });
        const data = await res.json(); if (!res.ok) throw new Error(data.error);
        setBody(""); await load();
      } catch (e) { setError(e instanceof Error ? e.message : "Unable to comment"); }
      finally { setPosting(false); }
    }}>
      <textarea aria-label="Your comment" required maxLength={1000} rows={2} value={body} onChange={e => setBody(e.target.value)} placeholder="Add a comment. Be respectful…" className="min-w-0 flex-1 rounded-lg border border-line bg-card p-3 text-sm" />
      <button disabled={posting || busy || !body.trim()} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{posting ? "Posting…" : "Comment"}</button>
    </form>
    {error && <p role="alert" className="my-2 text-sm text-red-400">{error} <button onClick={() => load()} className="underline">Retry</button></p>}
    <div className="space-y-4">{comments.map(c => <article key={c.id} className="flex gap-3">
      <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">{c.profile_name.slice(0, 1)}</span>
      <div className="min-w-0"><p className="text-xs font-semibold">{c.profile_name} <time className="ml-2 font-normal text-ink-3" dateTime={c.created_at}>{new Date(c.created_at).toLocaleDateString()}</time></p><p className="mt-1 whitespace-pre-wrap break-words text-sm text-ink-2">{c.body}</p></div>
    </article>)}</div>
    {!busy && !error && !comments.length && <p className="text-sm text-ink-3">Be the first to comment.</p>}
    {busy && <p role="status" className="text-sm text-ink-3">Loading comments…</p>}
    {more && <button disabled={busy || posting} onClick={() => load(comments.length)} className="mt-4 rounded-lg border border-line px-4 py-2 text-sm disabled:opacity-50">View more · 5 comments</button>}
  </section>;
}
