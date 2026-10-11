"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CheckCircle2, CloudUpload, Film, ImagePlus, Link2, LoaderCircle, PlaySquare, Plus, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type Category = { id: string; label: string };
type UploadItem = { id: string; file: File; thumbnail: File | null };
type PublishResult = { label: string; title?: string; status: string; error?: string; processing?: boolean; slug?: string };
type UploadMode = "files" | "embed" | "url";

function readableSize(size: number) {
  return `${(size / 1024 / 1024).toFixed(size > 100 * 1024 * 1024 ? 0 : 1)} MB`;
}

export default function UploadPage() {
  const [mode, setMode] = useState<UploadMode>("files");
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryId, setCategoryId] = useState("");
  const [localItems, setLocalItems] = useState<UploadItem[]>([]);
  const [embedInput, setEmbedInput] = useState("");
  const [embedThumbnail, setEmbedThumbnail] = useState<File | null>(null);
  const [remoteUrls, setRemoteUrls] = useState("");
  const [remoteThumbnail, setRemoteThumbnail] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [results, setResults] = useState<PublishResult[]>([]);

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("categories")
      .select("id, label")
      .order("label")
      .then(({ data }) => setCategories((data || []) as Category[]));
  }, []);

  const categoryLabel = useMemo(() => categories.find((category) => category.id === categoryId)?.label, [categories, categoryId]);

  function chooseLocalVideos(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []).filter((file) => file.type.startsWith("video/"));
    setLocalItems((current) => [
      ...current,
      ...files.map((file) => ({ id: `${file.name}-${file.lastModified}-${crypto.randomUUID()}`, file, thumbnail: null })),
    ]);
    event.target.value = "";
    setError("");
  }

  function setLocalThumbnail(id: string, file: File | null) {
    setLocalItems((current) => current.map((item) => (item.id === id ? { ...item, thumbnail: file } : item)));
  }

  async function publishLocal(event: FormEvent) {
    event.preventDefault();
    setError("");
    setResults([]);
    if (!categoryId) {
      setError("Choose a category before publishing.");
      return;
    }
    if (!localItems.length) {
      setError("Choose one or more video files.");
      return;
    }

    setLoading(true);
    const nextResults: PublishResult[] = [];
    for (const item of localItems) {
      try {
        const form = new FormData();
        form.append("file", item.file);
        form.append("categoryId", categoryId);
        if (item.thumbnail) form.append("thumbnail", item.thumbnail);
        const response = await fetch("/api/videos/upload", { method: "POST", body: form });
        const json = await response.json();
        if (!response.ok) throw new Error(json.error || "Upload failed");
        nextResults.push({
          label: item.file.name,
          title: json.metadata?.title,
          status: json.status || "published",
          processing: Boolean(json.processing),
          slug: json.video?.slug,
        });
      } catch (publishError: any) {
        nextResults.push({ label: item.file.name, status: "failed", error: publishError.message || "Upload failed" });
      }
    }
    setResults(nextResults);
    setLoading(false);
    if (nextResults.some((result) => result.status === "failed")) setError("Some videos could not be published. Review the results below.");
    else setLocalItems([]);
  }

  async function publishEmbed(event: FormEvent) {
    event.preventDefault();
    setError("");
    setResults([]);
    if (!categoryId) {
      setError("Choose a category before publishing.");
      return;
    }
    if (!embedInput.trim()) {
      setError("Paste an iframe source URL or iframe embed code.");
      return;
    }

    setLoading(true);
    try {
      const form = new FormData();
      form.append("embed", embedInput);
      form.append("categoryId", categoryId);
      if (embedThumbnail) form.append("thumbnail", embedThumbnail);
      const response = await fetch("/api/videos/embed", { method: "POST", body: form });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "Unable to publish embed");
      setResults([{ label: "Embedded video", title: json.metadata?.title, status: json.status || "published", slug: json.video?.slug }]);
      setEmbedInput("");
      setEmbedThumbnail(null);
    } catch (publishError: any) {
      setError(publishError.message || "Unable to publish embed");
    } finally {
      setLoading(false);
    }
  }

  async function publishRemoteUrls(event: FormEvent) {
    event.preventDefault();
    setError("");
    setResults([]);
    if (!categoryId) {
      setError("Choose a category before publishing.");
      return;
    }
    if (!remoteUrls.trim()) {
      setError("Enter one or more direct video URLs.");
      return;
    }

    setLoading(true);
    try {
      const form = new FormData();
      form.append("urls", remoteUrls);
      form.append("categoryId", categoryId);
      if (remoteThumbnail) form.append("thumbnail", remoteThumbnail);
      const response = await fetch("/api/videos/upload-url", { method: "POST", body: form });
      const json = await response.json();
      const remoteResults = (json.results || []).map((result: any) => ({
        label: result.remoteUrl || "Remote video",
        title: result.title,
        status: result.status || "failed",
        error: result.error,
        processing: result.processing,
      }));
      if (remoteResults.length) setResults(remoteResults);
      if (!response.ok) throw new Error(json.error || "Unable to queue remote upload");
      if (!json.failed) {
        setRemoteUrls("");
        setRemoteThumbnail(null);
      }
      if (json.failed) setError("Some remote URLs could not be queued. Review the results below.");
    } catch (publishError: any) {
      setError(publishError.message || "Unable to queue remote upload");
    } finally {
      setLoading(false);
    }
  }

  const modes: { key: UploadMode; label: string; icon: typeof CloudUpload; description: string }[] = [
    { key: "files", label: "Upload videos", icon: CloudUpload, description: "Upload one or more local video files to Uqload." },
    { key: "embed", label: "Embed by iframe", icon: PlaySquare, description: "Publish a trusted iframe source URL or iframe code." },
    { key: "url", label: "Upload by link", icon: Link2, description: "Send direct video URLs to Uqload for server-side import." },
  ];

  return (
    <div className="max-w-5xl">
      <div>
        <h1 className="text-[20px] font-semibold">Publish videos</h1>
        <p className="mt-1 text-[12px] text-ink-3">Choose a publishing method. Groq generates the title, description, and tags; you control only category and thumbnail.</p>
      </div>

      <div className="mt-6 grid gap-3 md:grid-cols-3">
        {modes.map((item) => {
          const Icon = item.icon;
          const active = mode === item.key;
          return (
            <button key={item.key} type="button" onClick={() => { setMode(item.key); setError(""); setResults([]); }} className={`rounded-lg border p-4 text-left transition ${active ? "border-accent bg-accent/[0.08]" : "border-line bg-pcard hover:border-ink-3"}`}>
              <Icon aria-hidden="true" className={`h-5 w-5 ${active ? "text-accent" : "text-ink-3"}`} />
              <p className="mt-3 text-[13px] font-semibold">{item.label}</p>
              <p className="mt-1 text-[11px] leading-relaxed text-ink-3">{item.description}</p>
            </button>
          );
        })}
      </div>

      <div className="mt-5 rounded-lg border border-line bg-pcard p-5">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line pb-5">
          <label className="block w-full max-w-sm">
            <span className="mb-1 block text-[11px] font-medium">Category *</span>
            <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)} required className="h-9 w-full rounded-md border border-line bg-void px-3 text-[13px]">
              <option value="">Choose a category</option>
              {categories.map((category) => <option key={category.id} value={category.id}>{category.label}</option>)}
            </select>
          </label>
          <p className="text-[11px] text-ink-3">Need a category? <Link href="/admin/categories" className="text-accent hover:underline">Manage categories</Link>.</p>
        </div>

        {mode === "files" && (
          <form onSubmit={publishLocal} className="pt-5">
            <div className="rounded-lg border border-dashed border-line bg-void p-5 text-center">
              <Film aria-hidden="true" className="mx-auto h-6 w-6 text-ink-3" />
              <p className="mt-2 text-[13px] font-medium">Select one or more video files</p>
              <p className="mt-1 text-[11px] text-ink-3">Each selected video gets AI-generated metadata and can have its own optional thumbnail.</p>
              <label className="mt-4 inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border border-line bg-card px-4 text-[12px] font-semibold hover:bg-card-hover">
                <Plus aria-hidden="true" className="h-4 w-4" />
                Add videos
                <input type="file" accept="video/*" multiple onChange={chooseLocalVideos} className="sr-only" />
              </label>
            </div>
            {localItems.length > 0 && (
              <div className="mt-4 space-y-3">
                {localItems.map((item) => (
                  <div key={item.id} className="flex flex-wrap items-center gap-3 rounded-md border border-line bg-void p-3">
                    <Film aria-hidden="true" className="h-4 w-4 shrink-0 text-ink-3" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12px] font-medium">{item.file.name}</p>
                      <p className="mt-0.5 text-[10.5px] text-ink-3">{readableSize(item.file.size)} · AI metadata will use this filename and “{categoryLabel || "selected category"}”.</p>
                    </div>
                    <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-line px-2.5 text-[11px] text-ink-2 hover:bg-white/5">
                      <ImagePlus aria-hidden="true" className="h-3.5 w-3.5" />
                      {item.thumbnail ? "Thumbnail added" : "Add thumbnail"}
                      <input type="file" accept="image/jpeg,image/png,image/gif,image/webp" onChange={(event) => setLocalThumbnail(item.id, event.target.files?.[0] || null)} className="sr-only" />
                    </label>
                    <button type="button" onClick={() => setLocalItems((current) => current.filter((entry) => entry.id !== item.id))} aria-label={`Remove ${item.file.name}`} className="rounded-md p-2 text-ink-3 hover:bg-white/5 hover:text-red-300"><Trash2 aria-hidden="true" className="h-4 w-4" /></button>
                  </div>
                ))}
              </div>
            )}
            <button type="submit" disabled={loading || !localItems.length} className="mt-5 inline-flex h-9 items-center gap-2 rounded-md bg-accent px-5 text-[13px] font-semibold text-white hover:bg-accent-soft disabled:opacity-50">
              {loading && <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" />}
              {loading ? "Publishing selected videos..." : `Generate AI metadata & publish${localItems.length > 1 ? ` ${localItems.length} videos` : " video"}`}
            </button>
          </form>
        )}

        {mode === "embed" && (
          <form onSubmit={publishEmbed} className="pt-5">
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium">Iframe URL or embed code *</span>
              <textarea value={embedInput} onChange={(event) => setEmbedInput(event.target.value)} required rows={5} className="w-full rounded-md border border-line bg-void px-3 py-2 font-mono text-[12px]" placeholder={'https://player.example.com/embed/abc\n—or—\n<iframe src="https://player.example.com/embed/abc" allowfullscreen></iframe>'} />
              <span className="mt-1 block text-[10.5px] text-ink-3">Only public http(s) iframe sources are accepted. The original iframe attributes are intentionally not stored.</span>
            </label>
            <label className="mt-4 flex min-h-20 cursor-pointer items-center gap-3 rounded-md border border-dashed border-line bg-void p-3 hover:border-ink-3">
              <ImagePlus aria-hidden="true" className="h-5 w-5 text-ink-3" />
              <span><span className="block text-[12px] font-medium">Optional video thumbnail</span><span className="mt-0.5 block text-[10.5px] text-ink-3">{embedThumbnail ? `${embedThumbnail.name} · ${readableSize(embedThumbnail.size)}` : "JPG, PNG, GIF, or WebP · max 10 MB"}</span></span>
              <input type="file" accept="image/jpeg,image/png,image/gif,image/webp" onChange={(event) => setEmbedThumbnail(event.target.files?.[0] || null)} className="sr-only" />
            </label>
            <button type="submit" disabled={loading} className="mt-5 inline-flex h-9 items-center gap-2 rounded-md bg-accent px-5 text-[13px] font-semibold text-white hover:bg-accent-soft disabled:opacity-50">
              {loading && <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" />}
              {loading ? "Generating & publishing..." : "Generate AI metadata & publish embed"}
            </button>
          </form>
        )}

        {mode === "url" && (
          <form onSubmit={publishRemoteUrls} className="pt-5">
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium">Direct video URLs *</span>
              <textarea value={remoteUrls} onChange={(event) => setRemoteUrls(event.target.value)} required rows={6} className="w-full rounded-md border border-line bg-void px-3 py-2 font-mono text-[12px]" placeholder={"https://cdn.example.com/video-one.mp4\nhttps://cdn.example.com/video-two.mp4"} />
              <span className="mt-1 block text-[10.5px] text-ink-3">One public video URL per line (up to 20). Each URL is queued directly with Uqload&apos;s remote-upload API.</span>
            </label>
            <label className="mt-4 flex min-h-20 cursor-pointer items-center gap-3 rounded-md border border-dashed border-line bg-void p-3 hover:border-ink-3">
              <ImagePlus aria-hidden="true" className="h-5 w-5 text-ink-3" />
              <span><span className="block text-[12px] font-medium">Optional thumbnail for this batch</span><span className="mt-0.5 block text-[10.5px] text-ink-3">{remoteThumbnail ? `${remoteThumbnail.name} · ${readableSize(remoteThumbnail.size)}` : "JPG, PNG, GIF, or WebP · max 10 MB"}</span></span>
              <input type="file" accept="image/jpeg,image/png,image/gif,image/webp" onChange={(event) => setRemoteThumbnail(event.target.files?.[0] || null)} className="sr-only" />
            </label>
            <button type="submit" disabled={loading} className="mt-5 inline-flex h-9 items-center gap-2 rounded-md bg-accent px-5 text-[13px] font-semibold text-white hover:bg-accent-soft disabled:opacity-50">
              {loading && <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" />}
              {loading ? "Queuing Uqload imports..." : "Generate AI metadata & publish through Uqload"}
            </button>
          </form>
        )}

        {error && <p className="mt-5 rounded-md bg-red-500/10 p-3 text-[12px] text-red-300">{error}</p>}
        {results.length > 0 && (
          <div className="mt-5 rounded-md border border-emerald-500/20 bg-emerald-500/[0.05] p-4">
            <div className="flex items-center gap-2"><CheckCircle2 aria-hidden="true" className="h-4 w-4 text-emerald-300" /><p className="text-[12px] font-semibold text-emerald-200">Publish results</p></div>
            <div className="mt-3 space-y-2">
              {results.map((result, index) => (
                <div key={`${result.label}-${index}`} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-void/70 px-3 py-2 text-[11px]">
                  <span className="min-w-0 truncate text-ink-2">{result.title ? `${result.title} — ${result.label}` : result.label}</span>
                  {result.error ? <span className="text-red-300">{result.error}</span> : <span className="uppercase text-emerald-300">{result.processing ? "Published · processing" : result.status}</span>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <p className="mt-4 text-[11px] leading-relaxed text-ink-3">A publish action makes the video public immediately. Uqload may still be encoding a newly uploaded or imported file; the public player will become playable as soon as the provider finishes processing.</p>
    </div>
  );
}
