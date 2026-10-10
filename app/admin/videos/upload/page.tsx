"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

export default function UploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [tags, setTags] = useState("");
  const [rights, setRights] = useState("pending");
  const [categories, setCategories] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState("");
  const [suggesting, setSuggesting] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase.from("categories").select("*").then(({ data }) => setCategories(data || []));
  }, []);

  const handleSuggest = async () => {
    if (!file && !title) return;
    setSuggesting(true);
    try {
      const res = await fetch("/api/groq/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, fileName: file?.name, category: categories.find(c => c.id === categoryId)?.label, tags }),
      });
      const json = await res.json();
      if (json.suggestion) {
        setTitle(json.suggestion.title || title);
        setDescription(json.suggestion.description || description);
        setTags((json.suggestion.tags || []).join(", "));
        const matchedCat = categories.find(c => c.label.toLowerCase() === json.suggestion.category.toLowerCase());
        if (matchedCat) setCategoryId(matchedCat.id);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setSuggesting(false);
    }
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) { setError("Select a video file"); return; }
    setError("");
    setLoading(true);
    setProgress(10);

    const form = new FormData();
    form.append("file", file);
    form.append("title", title);
    form.append("description", description);
    if (categoryId) form.append("categoryId", categoryId);
    form.append("tags", tags);
    form.append("rightsStatus", rights);

    try {
      const res = await fetch("/api/videos/upload", { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error + (json.details ? `: ${json.details}` : ""));
      setResult(json);
      setProgress(100);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-3xl">
      <h1 className="text-[20px] font-semibold">Upload Video</h1>
      <p className="mt-1 text-[12px] text-ink-3">Select local file, provide metadata, upload through approved hosting integration. Real upload, not simulated.</p>

      <div className="mt-6 rounded-lg border border-line bg-pcard p-5">
        <form onSubmit={handleUpload} className="space-y-4">
          <div>
            <label className="mb-1 block text-[11px] font-medium">Video file (drag & drop supported)</label>
            <input type="file" accept="video/*" onChange={(e) => { setFile(e.target.files?.[0] || null); if (e.target.files?.[0] && !title) setTitle(e.target.files[0].name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ")); }} className="w-full rounded-md border border-dashed border-line bg-void p-4 text-[12px]" />
            {file && <p className="mt-1 text-[11px] text-ink-3">{file.name} — {(file.size / 1024 / 1024).toFixed(1)} MB</p>}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-[11px]">Title *</span>
              <input value={title} onChange={(e) => setTitle(e.target.value)} required placeholder="Untitled video" className="h-9 w-full rounded-md border border-line bg-void px-3 text-[13px]" />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px]">Category</span>
              <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="h-9 w-full rounded-md border border-line bg-void px-3 text-[13px]">
                <option value="">Select category</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </label>
          </div>

          <label className="block">
            <span className="mb-1 block text-[11px]">Description</span>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="Short editorial summary..." className="w-full rounded-md border border-line bg-void px-3 py-2 text-[13px]" />
          </label>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-[11px]">Tags (comma separated)</span>
              <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="featured, 4k" className="h-9 w-full rounded-md border border-line bg-void px-3 text-[13px]" />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px]">Rights status *</span>
              <select value={rights} onChange={(e) => setRights(e.target.value)} className="h-9 w-full rounded-md border border-line bg-void px-3 text-[13px]">
                <option value="pending">Pending review</option>
                <option value="cleared">Cleared — owned/licensed</option>
                <option value="rejected">Rejected</option>
              </select>
            </label>
          </div>

          <div className="flex gap-2">
            <button type="button" onClick={handleSuggest} disabled={suggesting} className="h-9 rounded-md border border-line bg-card px-4 text-[12px] hover:bg-card-hover disabled:opacity-50">
              {suggesting ? "Generating..." : "✨ Suggest with Groq (optional)"}
            </button>
            <span className="text-[11px] text-ink-3 self-center">AI suggestions require human review, never auto-publish.</span>
          </div>

          {error && <p className="rounded-md bg-red-500/10 p-3 text-[12px] text-red-400">{error}</p>}
          {result && (
            <div className="rounded-md bg-emerald-500/10 p-3 text-[12px] text-emerald-300">
              <p>Upload {result.status} — Video ID: {result.videoId}</p>
              {result.note && <p className="mt-1 text-[11px] text-emerald-200/70">{result.note}</p>}
            </div>
          )}

          <div className="flex gap-3">
            <button type="submit" disabled={loading} className="inline-flex h-9 items-center rounded-md bg-accent px-5 text-[13px] font-semibold text-white hover:bg-accent-soft disabled:opacity-50">
              {loading ? `Uploading ${progress}%...` : "Upload & Process"}
            </button>
            {file && <button type="button" onClick={() => { setFile(null); setResult(null); setProgress(0); }} className="h-9 rounded-md border border-line bg-card px-4 text-[12px]">Clear</button>}
          </div>

          <p className="text-[11px] text-ink-3">Large files are streamed via provider protocol. Uqload is disabled for adult content without written approval — see DEPLOYMENT.md policy gate.</p>
        </form>
      </div>
    </div>
  );
}
