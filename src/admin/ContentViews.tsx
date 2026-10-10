import {
  Camera, Check, Drama, Eye, Flame, Flower2, HeartHandshake, LayoutGrid, ListVideo,
  Pencil, Plus, Sparkles, Trash2, UserRound, Users, VenetianMask, Wine,
} from "lucide-react";
import { useState } from "react";
import { Btn, Card, Field, Modal, ModalHeader, PageHeader, Select, TextArea } from "../portal/ui";
import type { AdminVideo, CategoryRec, Playlist } from "./data";
import { ConfirmDialog } from "./Modals";

const ICONS: Record<string, typeof Flame> = {
  flame: Flame, camera: Camera, eye: Eye, users: Users,
  mask: VenetianMask, wine: Wine, heart: HeartHandshake, grid: LayoutGrid,
  sparkles: Sparkles, user: UserRound, drama: Drama, flower: Flower2,
};

/* ---------------------------- Categories ---------------------------- */

export function CategoriesView({
  categories,
  onAdd,
  onUpdate,
  onDelete,
}: {
  categories: CategoryRec[];
  onAdd: (rec: Omit<CategoryRec, "id">) => void;
  onUpdate: (rec: CategoryRec) => void;
  onDelete: (id: string) => void;
}) {
  const [dialog, setDialog] = useState<CategoryRec | "new" | null>(null);
  const [toDelete, setToDelete] = useState<CategoryRec | null>(null);
  const [label, setLabel] = useState("");
  const [icon, setIcon] = useState("grid");
  const [error, setError] = useState("");

  const openDialog = (target: CategoryRec | "new") => {
    setDialog(target);
    setLabel(target === "new" ? "" : target.label);
    setIcon(target === "new" ? "grid" : target.icon);
    setError("");
  };

  const save = () => {
    if (label.trim().length < 3) {
      setError("Enter at least 3 characters.");
      return;
    }
    if (dialog === "new") onAdd({ label: label.trim(), icon, videos: 0 });
    else if (dialog) onUpdate({ ...dialog, label: label.trim(), icon });
    setDialog(null);
  };

  return (
    <div>
      <PageHeader
        title="Categories"
        sub={`${categories.length} content categories across the library.`}
        actions={
          <Btn size="sm" onClick={() => openDialog("new")}>
            <Plus className="h-3.5 w-3.5" aria-hidden /> Add Category
          </Btn>
        }
      />

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
        {categories.map((cat) => {
          const Icon = ICONS[cat.icon] ?? LayoutGrid;
          return (
            <Card key={cat.id} className="group p-4">
              <div className="flex items-start justify-between">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-accent/25 bg-accent/10">
                  <Icon className="h-4 w-4 text-accent" strokeWidth={1.8} aria-hidden />
                </span>
                <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                  <button type="button" aria-label={`Edit ${cat.label}`} onClick={() => openDialog(cat)} className="flex h-7 w-7 items-center justify-center rounded-md border border-line text-ink-3 hover:border-zinc-500 hover:text-ink">
                    <Pencil className="h-3 w-3" aria-hidden />
                  </button>
                  <button type="button" aria-label={`Remove ${cat.label}`} onClick={() => setToDelete(cat)} className="flex h-7 w-7 items-center justify-center rounded-md border border-line text-ink-3 hover:border-red-500/50 hover:text-red-400">
                    <Trash2 className="h-3 w-3" aria-hidden />
                  </button>
                </div>
              </div>
              <p className="mt-3 text-[13px] font-semibold text-ink">{cat.label}</p>
              <p className="mt-0.5 text-[11px] text-ink-3">{cat.videos} videos</p>
            </Card>
          );
        })}
      </div>

      {dialog && (
        <Modal onClose={() => setDialog(null)} maxW="max-w-sm">
          <ModalHeader title={dialog === "new" ? "Add Category" : "Edit Category"} onClose={() => setDialog(null)} />
          <div className="space-y-3.5 p-5">
            <Field label="Category name" value={label} onChange={(e) => setLabel(e.target.value)} error={error} />
            <label className="block">
              <span className="mb-1.5 block text-[11.5px] font-medium text-ink-2">Icon</span>
              <Select label="Icon" className="w-full [&>select]:h-9 [&>select]:w-full [&>select]:text-[12.5px]" value={icon} onChange={(e) => setIcon(e.target.value)}>
                {Object.keys(ICONS).map((k) => (
                  <option key={k} value={k}>{k}</option>
                ))}
              </Select>
            </label>
            <div className="flex gap-2 pt-1">
              <Btn variant="outline" className="flex-1" onClick={() => setDialog(null)}>Cancel</Btn>
              <Btn className="flex-1" onClick={save}>Save</Btn>
            </div>
          </div>
        </Modal>
      )}

      {toDelete && (
        <ConfirmDialog
          title="Remove category"
          message={`Remove “${toDelete.label}” from the library? Videos keep their stored label in this demo — nothing will break.`}
          confirmLabel="Remove"
          onClose={() => setToDelete(null)}
          onConfirm={() => {
            onDelete(toDelete.id);
            setToDelete(null);
          }}
        />
      )}
    </div>
  );
}

/* ----------------------------- Playlists ---------------------------- */

export function PlaylistsView({
  playlists,
  videos,
  onSave,
  onDelete,
}: {
  playlists: Playlist[];
  videos: AdminVideo[];
  onSave: (playlist: Playlist, isNew: boolean) => void;
  onDelete: (id: string) => void;
}) {
  const [dialog, setDialog] = useState<Playlist | "new" | null>(null);
  const [toDelete, setToDelete] = useState<Playlist | null>(null);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState("");

  const openDialog = (target: Playlist | "new") => {
    setDialog(target);
    setName(target === "new" ? "" : target.name);
    setDesc(target === "new" ? "" : target.desc);
    setSelected(target === "new" ? [] : target.videoIds);
    setError("");
  };

  const toggleVideo = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const save = () => {
    if (name.trim().length < 3) {
      setError("Enter at least 3 characters.");
      return;
    }
    onSave(
      {
        id: dialog === "new" ? `p-${Date.now()}` : (dialog as Playlist).id,
        name: name.trim(),
        desc: desc.trim(),
        videoIds: selected,
        updated: "Just now",
      },
      dialog === "new"
    );
    setDialog(null);
  };

  const thumbsFor = (p: Playlist) =>
    p.videoIds.map((id) => videos.find((v) => v.id === id)?.thumb).filter(Boolean).slice(0, 3) as string[];

  return (
    <div>
      <PageHeader
        title="Playlists"
        sub={`${playlists.length} curated playlists.`}
        actions={
          <Btn size="sm" onClick={() => openDialog("new")}>
            <Plus className="h-3.5 w-3.5" aria-hidden /> New Playlist
          </Btn>
        }
      />

      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {playlists.map((p) => (
          <Card key={p.id} className="group p-4">
            <div className="flex items-start justify-between">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-accent/25 bg-accent/10">
                <ListVideo className="h-4 w-4 text-accent" aria-hidden />
              </span>
              <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                <button type="button" aria-label={`Edit ${p.name}`} onClick={() => openDialog(p)} className="flex h-7 w-7 items-center justify-center rounded-md border border-line text-ink-3 hover:border-zinc-500 hover:text-ink">
                  <Pencil className="h-3 w-3" aria-hidden />
                </button>
                <button type="button" aria-label={`Delete ${p.name}`} onClick={() => setToDelete(p)} className="flex h-7 w-7 items-center justify-center rounded-md border border-line text-ink-3 hover:border-red-500/50 hover:text-red-400">
                  <Trash2 className="h-3 w-3" aria-hidden />
                </button>
              </div>
            </div>
            <p className="mt-3 text-[13.5px] font-semibold text-ink">{p.name}</p>
            <p className="mt-0.5 text-[11px] text-ink-3">{p.desc || "No description"}</p>
            <div className="mt-3 flex items-center justify-between border-t border-line/60 pt-3">
              <div className="flex -space-x-2">
                {thumbsFor(p).map((t, i) => (
                  <img key={i} src={t} alt="" className="h-7 w-12 rounded border border-line object-cover" draggable={false} />
                ))}
              </div>
              <span className="text-[11px] tabular-nums text-ink-3">{p.videoIds.length} videos · {p.updated}</span>
            </div>
          </Card>
        ))}
      </div>

      {dialog && (
        <Modal onClose={() => setDialog(null)} maxW="max-w-md">
          <ModalHeader title={dialog === "new" ? "New Playlist" : "Edit Playlist"} onClose={() => setDialog(null)} />
          <div className="space-y-3.5 p-5">
            <Field label="Playlist name" value={name} onChange={(e) => setName(e.target.value)} error={error} />
            <TextArea label="Description" rows={2} value={desc} onChange={(e) => setDesc(e.target.value)} />
            <div>
              <span className="mb-1.5 block text-[11.5px] font-medium text-ink-2">
                Videos ({selected.length} selected)
              </span>
              <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-line bg-pcard p-2">
                {videos.map((v) => {
                  const active = selected.includes(v.id);
                  return (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => toggleVideo(v.id)}
                      aria-pressed={active}
                      className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-white/[0.04]"
                    >
                      <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${active ? "border-accent bg-accent text-white" : "border-line bg-void"}`}>
                        {active && <Check className="h-3 w-3" aria-hidden />}
                      </span>
                      <img src={v.thumb} alt="" className="h-6 w-10 rounded border border-line object-cover" draggable={false} />
                      <span className="truncate text-[12px] text-ink-2">{v.title}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <Btn variant="outline" className="flex-1" onClick={() => setDialog(null)}>Cancel</Btn>
              <Btn className="flex-1" onClick={save}>Save playlist</Btn>
            </div>
          </div>
        </Modal>
      )}

      {toDelete && (
        <ConfirmDialog
          title="Delete playlist"
          message={`Delete “${toDelete.name}”? Videos inside it are not affected.`}
          confirmLabel="Delete"
          onClose={() => setToDelete(null)}
          onConfirm={() => {
            onDelete(toDelete.id);
            setToDelete(null);
          }}
        />
      )}
    </div>
  );
}
