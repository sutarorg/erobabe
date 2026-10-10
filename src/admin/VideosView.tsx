import { Search, Upload } from "lucide-react";
import { useMemo, useState } from "react";
import { Btn, Card, PageHeader, Select } from "../portal/ui";
import type { AdminVideo, CategoryRec } from "./data";
import type { AdminView } from "./AdminSidebar";
import VideosTable from "./VideosTable";

interface VideosViewProps {
  videos: AdminVideo[];
  categories: CategoryRec[];
  onNavigate: (view: AdminView) => void;
  onUploadClick: () => void;
  onPreview: (v: AdminVideo) => void;
  onEdit: (v: AdminVideo) => void;
  onDuplicate: (v: AdminVideo) => void;
  onToggleStatus: (v: AdminVideo) => void;
}

export default function VideosView({
  videos,
  categories,
  onUploadClick,
  onPreview,
  onEdit,
  onDuplicate,
  onToggleStatus,
}: VideosViewProps) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [status, setStatus] = useState("all");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return videos.filter(
      (v) =>
        (category === "all" || v.category === category) &&
        (status === "all" || v.status === status) &&
        (!q || v.title.toLowerCase().includes(q) || v.tags.some((t) => t.toLowerCase().includes(q)))
    );
  }, [videos, query, category, status]);

  return (
    <div>
      <PageHeader
        title="Videos"
        sub={`${videos.length} records in the library — search, filter and manage.`}
        actions={
          <Btn size="sm" onClick={onUploadClick}>
            <Upload className="h-3.5 w-3.5" aria-hidden />
            Upload Video
          </Btn>
        }
      />

      <Card className="mt-4 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex h-8 min-w-[200px] flex-1 items-center gap-2 rounded-md border border-line bg-void px-2.5 focus-within:border-accent/60">
            <Search className="h-3.5 w-3.5 shrink-0 text-ink-3" aria-hidden />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by title or tag…"
              aria-label="Search videos"
              className="w-full bg-transparent text-[12.5px] text-ink outline-none"
            />
          </div>
          <Select label="Filter by category" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="all">All Categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.label}>{c.label}</option>
            ))}
          </Select>
          <Select label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">All Status</option>
            <option value="published">Published</option>
            <option value="processing">Processing</option>
            <option value="draft">Draft</option>
            <option value="unpublished">Unpublished</option>
          </Select>
          <span className="ml-auto text-[11px] tabular-nums text-ink-3">
            {filtered.length} result{filtered.length === 1 ? "" : "s"}
          </span>
        </div>
      </Card>

      <Card className="mt-4 overflow-hidden">
        <VideosTable
          videos={filtered}
          onPreview={onPreview}
          onEdit={onEdit}
          onDuplicate={onDuplicate}
          onToggleStatus={onToggleStatus}
        />
        {filtered.length === 0 && (
          <p className="py-12 text-center text-[12.5px] text-ink-3">
            No videos match these filters.
          </p>
        )}
      </Card>
    </div>
  );
}
