import { Copy, Eye, Globe, MoreVertical, Pencil, Undo2 } from "lucide-react";
import { useState } from "react";
import { cn } from "../utils/cn";
import type { AdminVideo } from "./data";
import { AdminBadge, TH_CLASS } from "./widgets";

interface VideosTableProps {
  videos: AdminVideo[];
  onPreview: (video: AdminVideo) => void;
  onEdit: (video: AdminVideo) => void;
  onDuplicate: (video: AdminVideo) => void;
  onToggleStatus: (video: AdminVideo) => void;
}

function ActionBtn({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      aria-label={label}
      title={label}
      className="flex h-7 w-7 items-center justify-center rounded-md border border-line text-ink-3 transition-colors hover:border-zinc-500 hover:text-ink"
    >
      {children}
    </button>
  );
}

function RowMenu({
  onPreview,
  onDuplicate,
  onToggleStatus,
  isPublished,
}: {
  onPreview: () => void;
  onDuplicate: () => void;
  onToggleStatus: () => void;
  isPublished: boolean;
}) {
  const [open, setOpen] = useState(false);
  const item =
    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] text-ink-2 transition-colors hover:bg-white/5 hover:text-ink";
  return (
    <div className="relative">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        aria-label="More actions"
        aria-expanded={open}
        className="flex h-7 w-7 items-center justify-center rounded-md border border-line text-ink-3 transition-colors hover:border-zinc-500 hover:text-ink"
      >
        <MoreVertical className="h-3.5 w-3.5" aria-hidden />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={(e) => { e.stopPropagation(); setOpen(false); }} aria-hidden />
          <div className="eb-panel absolute right-0 top-full z-50 mt-1 w-40 rounded-lg border border-line bg-pcard-2 p-1 shadow-[0_12px_36px_rgba(0,0,0,0.55)]">
            <button type="button" className={item} onClick={() => { setOpen(false); onPreview(); }}>
              <Eye className="h-3.5 w-3.5 text-ink-3" aria-hidden /> Preview
            </button>
            <button type="button" className={item} onClick={() => { setOpen(false); onDuplicate(); }}>
              <Copy className="h-3.5 w-3.5 text-ink-3" aria-hidden /> Duplicate
            </button>
            <button type="button" className={item} onClick={() => { setOpen(false); onToggleStatus(); }}>
              {isPublished ? (
                <>
                  <Undo2 className="h-3.5 w-3.5 text-ink-3" aria-hidden /> Unpublish
                </>
              ) : (
                <>
                  <Globe className="h-3.5 w-3.5 text-ink-3" aria-hidden /> Publish
                </>
              )}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default function VideosTable({
  videos,
  onPreview,
  onEdit,
  onDuplicate,
  onToggleStatus,
}: VideosTableProps) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-left">
        <thead>
          <tr className="border-b border-line">
            {["Video", "Category", "Status", "Views", "Duration", "Uploaded", "Actions"].map((h) => (
              <th key={h} className={cn(TH_CLASS, h === "Actions" && "text-right")}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line/60">
          {videos.map((v) => (
            <tr
              key={v.id}
              onClick={() => onPreview(v)}
              className="cursor-pointer transition-colors hover:bg-white/[0.02]"
            >
              <td className="px-4 py-2.5">
                <div className="flex items-center gap-3">
                  <span className="relative block h-9 w-16 shrink-0 overflow-hidden rounded-md border border-line">
                    <img src={v.thumb} alt="" draggable={false} className="h-full w-full object-cover" />
                    <span className="absolute left-0.5 top-0.5 rounded bg-black/70 px-1 text-[8px] font-semibold text-zinc-100">
                      {v.quality}
                    </span>
                  </span>
                  <span className="max-w-[170px] truncate text-[12.5px] font-medium text-ink">{v.title}</span>
                </div>
              </td>
              <td className="whitespace-nowrap px-4 py-2.5 text-[11.5px] text-ink-2">{v.category}</td>
              <td className="px-4 py-2.5">
                <AdminBadge status={v.status} />
              </td>
              <td className="px-4 py-2.5 text-[12px] tabular-nums text-ink-2">{v.views}</td>
              <td className="px-4 py-2.5 text-[12px] tabular-nums text-ink-2">{v.duration}</td>
              <td className="whitespace-nowrap px-4 py-2.5 text-[11px] text-ink-3">{v.uploaded}</td>
              <td className="px-4 py-2.5">
                <div className="flex items-center justify-end gap-1.5">
                  <ActionBtn label={`Preview ${v.title}`} onClick={() => onPreview(v)}>
                    <Eye className="h-3.5 w-3.5" aria-hidden />
                  </ActionBtn>
                  <ActionBtn label={`Edit ${v.title}`} onClick={() => onEdit(v)}>
                    <Pencil className="h-3.5 w-3.5" aria-hidden />
                  </ActionBtn>
                  <RowMenu
                    isPublished={v.status === "published"}
                    onPreview={() => onPreview(v)}
                    onDuplicate={() => onDuplicate(v)}
                    onToggleStatus={() => onToggleStatus(v)}
                  />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
