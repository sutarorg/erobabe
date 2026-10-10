import {
  Building2, CircleCheck, CircleX, Copy, Globe, Layers, Link2,
  Megaphone, Pencil, Play, Undo2, UserRound,
} from "lucide-react";
import { useState } from "react";
import type {
  AdminSlot, AdminVideo, CategoryRec, PendingAd, PendingAdvertiser, PendingVideo, Report,
} from "./data";
import { fmtUSD, SLOT_PRICE } from "./data";
import { Btn, Drawer, Field, Modal, ModalHeader, Select, TextArea } from "../portal/ui";
import { AdminBadge } from "./widgets";
import { cn } from "../utils/cn";

/* ============================ VIDEO DRAWER =========================== */

export function VideoDrawer({
  video,
  categories,
  mode,
  onClose,
  onSave,
  onToggleStatus,
  onDuplicate,
}: {
  video: AdminVideo;
  categories: CategoryRec[];
  mode: "preview" | "edit";
  onClose: () => void;
  onSave: (video: AdminVideo) => void;
  onToggleStatus: (video: AdminVideo) => void;
  onDuplicate: (video: AdminVideo) => void;
}) {
  const [editing, setEditing] = useState(mode === "edit");
  const [title, setTitle] = useState(video.title);
  const [description, setDescription] = useState(video.description);
  const [category, setCategory] = useState(video.category);
  const [tags, setTags] = useState(video.tags.join(", "));
  const [error, setError] = useState("");

  const save = () => {
    if (title.trim().length < 3) {
      setError("Title must be at least 3 characters.");
      return;
    }
    onSave({
      ...video,
      title: title.trim(),
      description: description.trim(),
      category,
      tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
    });
    setEditing(false);
  };

  return (
    <Drawer onClose={onClose} title={editing ? "Edit Video" : video.title} sub={editing ? "Changes stay in local state" : `${video.category} · ${video.quality}`}>
      <div className="relative aspect-video overflow-hidden rounded-lg border border-line bg-black">
        <img src={video.thumb} alt="" className="h-full w-full object-cover opacity-70" draggable={false} />
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-accent text-white shadow-[0_8px_32px_rgba(245,22,85,0.45)]">
            <Play className="ml-0.5 h-4 w-4 fill-current" aria-hidden />
          </span>
        </div>
        <span className="absolute left-2 top-2 rounded bg-black/70 px-1.5 py-0.5 text-[9px] font-semibold text-zinc-100">
          {video.quality}
        </span>
        <span className="absolute bottom-2 right-2 rounded bg-black/75 px-1.5 py-0.5 text-[10px] tabular-nums text-zinc-100">
          {video.duration}
        </span>
      </div>

      {editing ? (
        <div className="mt-4 space-y-3.5">
          <Field label="Title" value={title} onChange={(e) => setTitle(e.target.value)} error={error} />
          <TextArea label="Description" value={description} onChange={(e) => setDescription(e.target.value)} />
          <label className="block">
            <span className="mb-1.5 block text-[11.5px] font-medium text-ink-2">Category</span>
            <Select label="Category" className="w-full [&>select]:h-9 [&>select]:w-full [&>select]:text-[12.5px]" value={category} onChange={(e) => setCategory(e.target.value)}>
              {categories.map((c) => (
                <option key={c.id} value={c.label}>{c.label}</option>
              ))}
            </Select>
          </label>
          <Field label="Tags (comma separated)" value={tags} onChange={(e) => setTags(e.target.value)} />
          <div className="flex gap-2 pt-1">
            <Btn variant="outline" className="flex-1" onClick={() => setEditing(false)}>Cancel</Btn>
            <Btn className="flex-1" onClick={save}>Save changes</Btn>
          </div>
        </div>
      ) : (
        <div className="mt-4">
          <div className="flex items-center justify-between">
            <AdminBadge status={video.status} />
            <span className="text-[12px] tabular-nums text-ink-3">{video.views} views</span>
          </div>
          <div className="mt-3 rounded-lg border border-line bg-pcard px-3.5">
            <div className="flex justify-between border-b border-line/60 py-2.5 text-[12px]"><span className="text-ink-3">Category</span><span className="font-medium text-ink">{video.category}</span></div>
            <div className="flex justify-between border-b border-line/60 py-2.5 text-[12px]"><span className="text-ink-3">Duration</span><span className="font-medium tabular-nums text-ink">{video.duration}</span></div>
            <div className="flex justify-between py-2.5 text-[12px]"><span className="text-ink-3">Uploaded</span><span className="font-medium text-ink">{video.uploaded}</span></div>
          </div>
          <p className="mt-3 text-[12px] leading-relaxed text-ink-3">{video.description}</p>
          {video.tags.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {video.tags.map((t) => (
                <span key={t} className="rounded-full border border-line px-2 py-0.5 text-[10px] text-ink-3">#{t}</span>
              ))}
            </div>
          )}
          <div className="mt-4 grid grid-cols-3 gap-2">
            <Btn variant="outline" size="sm" onClick={() => setEditing(true)}>
              <Pencil className="h-3.5 w-3.5" aria-hidden /> Edit
            </Btn>
            <Btn variant="outline" size="sm" onClick={() => onDuplicate(video)}>
              <Copy className="h-3.5 w-3.5" aria-hidden /> Duplicate
            </Btn>
            <Btn variant="accentOutline" size="sm" onClick={() => onToggleStatus(video)}>
              {video.status === "published" ? (
                <><Undo2 className="h-3.5 w-3.5" aria-hidden /> Unpublish</>
              ) : (
                <><Globe className="h-3.5 w-3.5" aria-hidden /> Publish</>
              )}
            </Btn>
          </div>
        </div>
      )}
    </Drawer>
  );
}

/* ============================= SLOT MODAL ============================ */

export function SlotModal({
  slot,
  onClose,
  onSave,
}: {
  slot: AdminSlot;
  onClose: () => void;
  onSave: (slot: AdminSlot) => void;
}) {
  const [status, setStatus] = useState<AdminSlot["status"]>(slot.status);
  const [advertiser, setAdvertiser] = useState(slot.advertiser ?? "");
  const [campaign, setCampaign] = useState(slot.campaignName ?? "");
  const [start, setStart] = useState(slot.start ?? "Dec 15");
  const [end, setEnd] = useState(slot.end ?? "Jan 14");

  return (
    <Modal onClose={onClose} maxW="max-w-md">
      <ModalHeader title={`Slot ${slot.id} — ${slot.name}`} sub="Fixed-price 16:9 placement" onClose={onClose} />
      <div className="p-5">
        <div className="flex aspect-video flex-col items-center justify-center gap-1 rounded-lg border border-accent/35 bg-pcard">
          <span className="text-[11px] font-semibold uppercase tracking-[0.24em] text-zinc-300">Ad Slot {slot.id}</span>
          <span className="text-[11px] font-medium tracking-[0.16em] text-accent">16:9</span>
          <span className="mt-1 text-[10px] text-ink-3">{slot.side === "left" ? "Left rail" : "Right rail"} placement</span>
        </div>

        <div className="mt-3 flex items-center justify-between">
          <AdminBadge status={status === "active" ? "active" : "available"} />
          <span className="text-[14px] font-semibold text-ink">
            {fmtUSD(SLOT_PRICE)}<span className="text-[10.5px] font-medium text-ink-3"> /month</span>
          </span>
        </div>

        <div className="mt-4 space-y-3.5">
          <label className="block">
            <span className="mb-1.5 block text-[11.5px] font-medium text-ink-2">Availability</span>
            <Select label="Availability" className="w-full [&>select]:h-9 [&>select]:w-full [&>select]:text-[12.5px]" value={status} onChange={(e) => setStatus(e.target.value as AdminSlot["status"])}>
              <option value="available">Available</option>
              <option value="active">Occupied (Active)</option>
            </Select>
          </label>
          {status === "active" && (
            <>
              <Field label="Advertiser" value={advertiser} onChange={(e) => setAdvertiser(e.target.value)} placeholder="e.g. EroAds Media" />
              <Field label="Campaign name" value={campaign} onChange={(e) => setCampaign(e.target.value)} placeholder="e.g. EroX Promo" />
              <div className="grid grid-cols-2 gap-3">
                <Field label="Start" value={start} onChange={(e) => setStart(e.target.value)} />
                <Field label="End" value={end} onChange={(e) => setEnd(e.target.value)} />
              </div>
            </>
          )}
        </div>

        <div className="mt-4 flex gap-2">
          <Btn variant="outline" className="flex-1" onClick={onClose}>Cancel</Btn>
          <Btn
            className="flex-1"
            onClick={() =>
              onSave({
                ...slot,
                status,
                advertiser: status === "active" ? advertiser || "Unassigned" : undefined,
                campaignName: status === "active" ? campaign : undefined,
                start: status === "active" ? start : undefined,
                end: status === "active" ? end : undefined,
              })
            }
          >
            Save changes
          </Btn>
        </div>
        <p className="mt-2.5 text-center text-[10.5px] text-ink-3">Local edits only — no reservation API exists.</p>
      </div>
    </Modal>
  );
}

/* ============================ REPORT MODAL =========================== */

export function ReportModal({
  report,
  onClose,
  onSave,
}: {
  report: Report;
  onClose: () => void;
  onSave: (report: Report) => void;
}) {
  const [status, setStatus] = useState(report.status);
  const [note, setNote] = useState(report.note ?? "");

  return (
    <Modal onClose={onClose} maxW="max-w-md">
      <ModalHeader title={`${report.type} report`} sub={`Filed by ${report.reportedBy} · ${report.date}`} onClose={onClose} />
      <div className="p-5">
        <div className="rounded-lg border border-line bg-pcard px-3.5">
          <div className="flex justify-between border-b border-line/60 py-2.5 text-[12px]"><span className="text-ink-3">Reason</span><span className="font-medium text-ink">{report.reason}</span></div>
          <div className="flex justify-between border-b border-line/60 py-2.5 text-[12px]"><span className="text-ink-3">Content</span><span className="font-medium text-ink">{report.content}</span></div>
          <div className="flex justify-between py-2.5 text-[12px]"><span className="text-ink-3">Current status</span><AdminBadge status={report.status} /></div>
        </div>

        <div className="mt-4 space-y-3.5">
          <label className="block">
            <span className="mb-1.5 block text-[11.5px] font-medium text-ink-2">Set status</span>
            <Select label="Set status" className="w-full [&>select]:h-9 [&>select]:w-full [&>select]:text-[12.5px]" value={status} onChange={(e) => setStatus(e.target.value as Report["status"])}>
              <option value="new">New</option>
              <option value="in-review">In Review</option>
              <option value="resolved">Resolved</option>
            </Select>
          </label>
          <TextArea label="Resolution note" placeholder="Record a mock resolution note…" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>

        <div className="mt-4 flex gap-2">
          <Btn variant="outline" className="flex-1" onClick={onClose}>Cancel</Btn>
          <Btn className="flex-1" onClick={() => onSave({ ...report, status, note: note.trim() || undefined })}>
            Save report
          </Btn>
        </div>
      </div>
    </Modal>
  );
}

/* ============================ REVIEW MODAL =========================== */

const RIGHTS_CHECKS = ["Age verification on file (18+)", "Distribution rights confirmed", "Metadata & tags complete"];

export type ReviewKind = "videos" | "ads" | "advertisers";

export function ReviewModal({
  kind,
  videos,
  ads,
  advertisers,
  onResolve,
  onClose,
}: {
  kind: ReviewKind;
  videos: PendingVideo[];
  ads: PendingAd[];
  advertisers: PendingAdvertiser[];
  onResolve: (kind: ReviewKind, id: string, approved: boolean) => void;
  onClose: () => void;
}) {
  const [checks, setChecks] = useState<Record<string, number[]>>({});
  const toggleCheck = (id: string, idx: number) =>
    setChecks((c) => {
      const cur = c[id] ?? [];
      return { ...c, [id]: cur.includes(idx) ? cur.filter((x) => x !== idx) : [...cur, idx] };
    });

  const titles = { videos: "Video review queue", ads: "Advertisement review queue", advertisers: "Advertiser review queue" };
  const count = kind === "videos" ? videos.length : kind === "ads" ? ads.length : advertisers.length;

  const actionRow = (id: string, approveDisabled = false) => (
    <div className="flex gap-2">
      <Btn size="sm" variant="outline" className="flex-1 !border-emerald-500/40 !text-emerald-400 hover:!bg-emerald-500/10" disabled={approveDisabled} onClick={() => onResolve(kind, id, true)}>
        <CircleCheck className="h-3.5 w-3.5" aria-hidden /> Approve
      </Btn>
      <Btn size="sm" variant="outline" className="flex-1 !border-red-500/40 !text-red-400 hover:!bg-red-500/10" onClick={() => onResolve(kind, id, false)}>
        <CircleX className="h-3.5 w-3.5" aria-hidden /> Reject
      </Btn>
    </div>
  );

  return (
    <Modal onClose={onClose} maxW="max-w-lg">
      <ModalHeader title={titles[kind]} sub={`${count} item${count === 1 ? "" : "s"} shown — mock queue, local decisions only`} onClose={onClose} />
      <div className="max-h-[62vh] space-y-3 overflow-y-auto p-5">
        {kind === "videos" && videos.map((v) => {
          const done = (checks[v.id] ?? []).length;
          return (
            <div key={v.id} className="rounded-lg border border-line bg-pcard p-3">
              <div className="flex items-center gap-3">
                <img src={v.thumb} alt="" className="h-10 w-[72px] rounded-md border border-line object-cover" draggable={false} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-ink">{v.title}</p>
                  <p className="mt-0.5 text-[10.5px] text-ink-3">{v.category} · by {v.uploader} · {v.submitted}</p>
                </div>
                <AdminBadge status="pending" />
              </div>
              <div className="mt-3 space-y-1.5">
                {RIGHTS_CHECKS.map((label, idx) => {
                  const active = (checks[v.id] ?? []).includes(idx);
                  return (
                    <button key={idx} type="button" onClick={() => toggleCheck(v.id, idx)} aria-pressed={active} className="flex w-full items-center gap-2 text-left">
                      <span className={cn("flex h-4 w-4 items-center justify-center rounded border transition-colors", active ? "border-accent bg-accent text-white" : "border-line bg-void")}>
                        {active && <CircleCheck className="h-3 w-3" aria-hidden />}
                      </span>
                      <span className="text-[11.5px] text-ink-2">{label}</span>
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 text-[10px] text-ink-3">{done}/3 rights checks completed {done < 3 ? "— complete all to approve" : ""}</p>
              <div className="mt-2.5">{actionRow(v.id, done < 3)}</div>
            </div>
          );
        })}

        {kind === "ads" && ads.map((a) => (
          <div key={a.id} className="rounded-lg border border-line bg-pcard p-3">
            <div className="flex items-center gap-3">
              <img src={a.thumb} alt="" className="h-10 w-[72px] rounded-md border border-line object-cover" draggable={false} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium text-ink">{a.advertiser}</p>
                <p className="mt-0.5 flex items-center gap-1 truncate text-[10.5px] text-ink-3">
                  <Link2 className="h-3 w-3 shrink-0" aria-hidden />{a.url}
                </p>
                <p className="mt-0.5 text-[10.5px] text-ink-3">Slot {a.slotId} · {a.slotName} · {a.duration}</p>
              </div>
              <AdminBadge status="in-review" />
            </div>
            <div className="mt-2.5">{actionRow(a.id)}</div>
          </div>
        ))}

        {kind === "advertisers" && advertisers.map((a) => (
          <div key={a.id} className="rounded-lg border border-line bg-pcard p-3">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-accent/40 bg-accent/15">
                <Building2 className="h-4 w-4 text-accent" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium text-ink">{a.name}</p>
                <p className="mt-0.5 flex items-center gap-1 text-[10.5px] text-ink-3">
                  <UserRound className="h-3 w-3" aria-hidden />{a.contact} · {a.email}
                </p>
                <p className="mt-0.5 text-[10.5px] text-ink-3">Registered {a.registered}</p>
              </div>
              <AdminBadge status="pending" />
            </div>
            <div className="mt-2.5">{actionRow(a.id)}</div>
          </div>
        ))}

        {count === 0 && (
          <div className="py-10 text-center">
            <CircleCheck className="mx-auto h-8 w-8 text-emerald-500" aria-hidden />
            <p className="mt-3 text-[13px] font-medium text-ink">Queue clear</p>
            <p className="mt-1 text-[11.5px] text-ink-3">Nothing left to review right now (demo).</p>
          </div>
        )}
      </div>
    </Modal>
  );
}

/* ========================== ENTITY DIALOGS =========================== */

export function AdDialog({
  slots,
  onClose,
  onSave,
}: {
  slots: AdminSlot[];
  onClose: () => void;
  onSave: (data: { name: string; url: string; slotId: number }) => void;
}) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [slotId, setSlotId] = useState<number>(slots.find((s) => s.status === "available")?.id ?? slots[0]?.id ?? 1);
  const [error, setError] = useState("");

  return (
    <Modal onClose={onClose} maxW="max-w-md">
      <ModalHeader title="Add Advertisement" sub="Register a creative and assign a placement" onClose={onClose} />
      <div className="space-y-3.5 p-5">
        <Field label="Creative name" placeholder="e.g. Winter Push — Banner v1" value={name} onChange={(e) => setName(e.target.value)} />
        <Field label="Destination URL" placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} error={error} />
        <label className="block">
          <span className="mb-1.5 block text-[11.5px] font-medium text-ink-2">Assigned slot</span>
          <Select label="Assigned slot" className="w-full [&>select]:h-9 [&>select]:w-full [&>select]:text-[12.5px]" value={slotId} onChange={(e) => setSlotId(Number(e.target.value))}>
            {slots.map((s) => (
              <option key={s.id} value={s.id}>Slot {s.id} · {s.name}{s.status === "active" ? " (occupied)" : ""}</option>
            ))}
          </Select>
        </label>
        <div className="flex gap-2 pt-1">
          <Btn variant="outline" className="flex-1" onClick={onClose}>Cancel</Btn>
          <Btn className="flex-1" onClick={() => {
            if (name.trim().length < 3) { setError("Enter a creative name."); return; }
            if (!/^https?:\/\/.+\..+/.test(url.trim())) { setError("Enter a valid https:// URL."); return; }
            onSave({ name: name.trim(), url: url.trim(), slotId });
          }}>
            <Megaphone className="h-3.5 w-3.5" aria-hidden /> Add creative
          </Btn>
        </div>
      </div>
    </Modal>
  );
}

export function CreateSlotDialog({
  onClose,
  onSave,
}: {
  onClose: () => void;
  onSave: (data: { name: string; side: "left" | "right" }) => void;
}) {
  const [name, setName] = useState("");
  const [side, setSide] = useState<"left" | "right">("left");
  const [error, setError] = useState("");
  return (
    <Modal onClose={onClose} maxW="max-w-sm">
      <ModalHeader title="Create Ad Slot" sub="Propose an additional 16:9 placement" onClose={onClose} />
      <div className="space-y-3.5 p-5">
        <Field label="Placement name" placeholder="e.g. Left Sidebar 6" value={name} onChange={(e) => setName(e.target.value)} error={error} />
        <label className="block">
          <span className="mb-1.5 block text-[11.5px] font-medium text-ink-2">Rail</span>
          <Select label="Rail" className="w-full [&>select]:h-9 [&>select]:w-full [&>select]:text-[12.5px]" value={side} onChange={(e) => setSide(e.target.value as "left" | "right")}>
            <option value="left">Left rail</option>
            <option value="right">Right rail</option>
          </Select>
        </label>
        <p className="flex items-center gap-2 rounded-lg border border-line bg-pcard px-3 py-2.5 text-[11.5px] text-ink-3">
          <Layers className="h-3.5 w-3.5 text-accent" aria-hidden />
          Rate card applies automatically — {fmtUSD(SLOT_PRICE)}/month, fixed 16:9 ratio.
        </p>
        <div className="flex gap-2 pt-1">
          <Btn variant="outline" className="flex-1" onClick={onClose}>Cancel</Btn>
          <Btn className="flex-1" onClick={() => {
            if (name.trim().length < 3) { setError("Enter at least 3 characters."); return; }
            onSave({ name: name.trim(), side });
          }}>Create slot</Btn>
        </div>
      </div>
    </Modal>
  );
}

export function AdvertiserDialog({
  onClose,
  onSave,
}: {
  onClose: () => void;
  onSave: (data: { name: string; contact: string; email: string }) => void;
}) {
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  return (
    <Modal onClose={onClose} maxW="max-w-sm">
      <ModalHeader title="Add Advertiser" sub="Create a mock advertiser account" onClose={onClose} />
      <div className="space-y-3.5 p-5">
        <Field label="Business name" placeholder="e.g. Scarlet Digital" value={name} onChange={(e) => setName(e.target.value)} />
        <Field label="Contact person" placeholder="Full name" value={contact} onChange={(e) => setContact(e.target.value)} />
        <Field label="Email" type="email" placeholder="name@company.com" value={email} onChange={(e) => setEmail(e.target.value)} error={error} />
        <div className="flex gap-2 pt-1">
          <Btn variant="outline" className="flex-1" onClick={onClose}>Cancel</Btn>
          <Btn className="flex-1" onClick={() => {
            if (name.trim().length < 2) { setError("Business name is required."); return; }
            if (!/^\S+@\S+\.\S+$/.test(email)) { setError("Enter a valid email address."); return; }
            onSave({ name: name.trim(), contact: contact.trim() || "—", email });
          }}>Add advertiser</Btn>
        </div>
      </div>
    </Modal>
  );
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  onConfirm,
  onClose,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal onClose={onClose} maxW="max-w-sm">
      <ModalHeader title={title} onClose={onClose} />
      <div className="p-5">
        <p className="text-[12.5px] leading-relaxed text-ink-2">{message}</p>
        <div className="mt-4 flex gap-2">
          <Btn variant="outline" className="flex-1" onClick={onClose}>Cancel</Btn>
          <Btn className="flex-1" onClick={onConfirm}>{confirmLabel}</Btn>
        </div>
      </div>
    </Modal>
  );
}
