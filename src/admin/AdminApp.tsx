import { CircleCheck, Menu } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { LOGO_URL } from "../data/content";
import { AdvertisementsView, AdSlotsView } from "./AdViews";
import AdminSidebar, { type AdminView } from "./AdminSidebar";
import { AdvertisersView, CampaignsView, PaymentsView } from "./BusinessViews";
import { CategoriesView, PlaylistsView } from "./ContentViews";
import DashboardView from "./DashboardView";
import UploadView, { type UploadPayload } from "./UploadView";
import {
  ADMIN_NOTICES, FALLBACK_THUMB, INITIAL_ADS, INITIAL_ADVERTISERS, INITIAL_CAMPAIGNS,
  INITIAL_CATEGORIES, INITIAL_LOGS, INITIAL_PAYMENTS, INITIAL_PLAYLISTS, INITIAL_REPORTS,
  INITIAL_SETTINGS, INITIAL_SLOTS, INITIAL_USERS, SLOT_PRICE,
  type AdCreative, type AdminSlot, type AdminVideo, type Advertiser, type CategoryRec,
  type LogEntry, type Playlist, type Report, type SiteSettings, type UserAccount,
  INITIAL_VIDEOS,
} from "./data";
import {
  AdDialog, AdvertiserDialog, CreateSlotDialog, ReportModal, SlotModal, VideoDrawer,
} from "./Modals";
import { LogsView, SettingsView, SystemHealthView } from "./SystemViews";
import { ReportsView, UsersView } from "./ModerationViews";
import VideosView from "./VideosView";

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function nowStamp() {
  const d = new Date();
  return `${MONTHS[d.getMonth()]} ${String(d.getDate()).padStart(2, "0")}, ${d.getFullYear()} · ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
function todayStamp() {
  const d = new Date();
  return `${MONTHS[d.getMonth()]} ${String(d.getDate()).padStart(2, "0")}, ${d.getFullYear()}`;
}

export default function AdminApp({ onSite, onAdvertise }: { onSite: () => void; onAdvertise: () => void }) {
  const [view, setView] = useState<AdminView>("dashboard");
  const [menuOpen, setMenuOpen] = useState(false);
  const mainRef = useRef<HTMLElement>(null);

  /* ---- entity state (all mock, all local) --------------------------- */
  const [videos, setVideos] = useState<AdminVideo[]>(INITIAL_VIDEOS);
  const [categories, setCategories] = useState<CategoryRec[]>(INITIAL_CATEGORIES);
  const [playlists, setPlaylists] = useState<Playlist[]>(INITIAL_PLAYLISTS);
  const [ads, setAds] = useState<AdCreative[]>(INITIAL_ADS);
  const [slots, setSlots] = useState<AdminSlot[]>(INITIAL_SLOTS);
  const [advertisers, setAdvertisers] = useState<Advertiser[]>(INITIAL_ADVERTISERS);
  const [reports, setReports] = useState<Report[]>(INITIAL_REPORTS);
  const [users, setUsers] = useState<UserAccount[]>(INITIAL_USERS);
  const [logs, setLogs] = useState<LogEntry[]>(INITIAL_LOGS);
  const [settings, setSettings] = useState<SiteSettings>(INITIAL_SETTINGS);
  const [notices, setNotices] = useState(ADMIN_NOTICES);

  /* ---- overlays -------------------------------------------------------- */
  const [videoDrawer, setVideoDrawer] = useState<{ video: AdminVideo; mode: "preview" | "edit" } | null>(null);
  const [openSlot, setOpenSlot] = useState<AdminSlot | null>(null);
  const [openReport, setOpenReport] = useState<Report | null>(null);
  const [adDialog, setAdDialog] = useState(false);
  const [slotDialog, setSlotDialog] = useState(false);
  const [advertiserDialog, setAdvertiserDialog] = useState(false);


  /* ---- toast ------------------------------------------------------------ */
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);
  const notify = useCallback((message: string) => {
    window.clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = window.setTimeout(() => setToast(null), 3400);
  }, []);

  const addLog = useCallback((action: string, target: string, level: LogEntry["level"] = "info") => {
    setLogs((ls) => [{ id: `l-${Date.now()}`, time: nowStamp(), actor: "Admin User", action, target, level }, ...ls]);
  }, []);

  const navigate = useCallback((next: AdminView) => {
    setView(next);
    setMenuOpen(false);
    mainRef.current?.scrollTo({ top: 0 });
  }, []);

  /* ---- video operations --------------------------------------------------- */
  const saveVideo = useCallback((v: AdminVideo) => {
    setVideos((all) => all.map((x) => (x.id === v.id ? v : x)));
    setVideoDrawer((cur) => (cur ? { ...cur, video: v } : cur));
    notify("Changes saved (local state only).");
  }, [notify]);

  const duplicateVideo = useCallback((v: AdminVideo) => {
    const copy: AdminVideo = {
      ...v,
      id: `v-${Date.now()}`,
      title: `${v.title} (Copy)`,
      status: "draft",
      views: "—",
      uploaded: nowStamp(),
    };
    setVideos((all) => [copy, ...all]);
    addLog("Duplicated video", v.title);
    notify(`Duplicated “${v.title}” as a draft.`);
  }, [addLog, notify]);

  const toggleVideoStatus = useCallback((v: AdminVideo) => {
    const next = v.status === "published" ? "unpublished" : "published";
    setVideos((all) => all.map((x) => (x.id === v.id ? { ...x, status: next, views: next === "published" && x.views === "—" ? "0" : x.views } : x)));
    setVideoDrawer((cur) => (cur && cur.video.id === v.id ? { ...cur, video: { ...cur.video, status: next } } : cur));
    addLog(next === "published" ? "Published video" : "Unpublished video", v.title);
    notify(next === "published" ? `“${v.title}” is now live.` : `“${v.title}” was unpublished.`);
  }, [addLog, notify]);

  /* Simulated bulk ingest — inserts mock records. Nothing is uploaded or fetched. */
  const publishUpload = useCallback(
    (payloads: UploadPayload[]) => {
      if (payloads.length === 0) return;
      const stamp = nowStamp();
      const recs: AdminVideo[] = payloads.map((p, i) => {
        const sourceNote =
          p.source === "file"
            ? `file upload · ${p.sourceLabel}`
            : p.source === "iframe"
              ? `iframe embed · ${p.sourceLabel}`
              : `link import · ${p.sourceLabel}`;
        return {
          id: `v-${Date.now()}-${i}`,
          title: p.title,
          category: p.category,
          status: p.publish ? "processing" : "draft",
          views: "—",
          duration: p.duration,
          uploaded: stamp,
          quality: p.quality,
          thumb: p.thumb || FALLBACK_THUMB,
          description:
            p.description ||
            `Simulated ${sourceNote}. Nothing was transmitted anywhere — this record is a local demo placeholder.`,
          tags: p.tags,
        };
      });
      setVideos((all) => [...recs, ...all]);
      const published = payloads[0].publish;
      const label =
        payloads.length === 1
          ? `“${payloads[0].title}”`
          : `${payloads.length} videos`;
      addLog(
        published ? "Uploaded videos (simulated)" : "Saved drafts (simulated)",
        label
      );
      notify(
        published
          ? `${label} added to the library (simulated).`
          : `${label} saved as draft${payloads.length === 1 ? "" : "s"}.`
      );
    },
    [addLog, notify]
  );

  /* ---- slot operations ------------------------------------------------------ */
  const saveSlot = useCallback((slot: AdminSlot) => {
    setSlots((all) => all.map((s) => (s.id === slot.id ? slot : s)));
    addLog("Updated ad slot", `Slot ${slot.id} · ${slot.name}`);
    notify(`Slot ${slot.id} updated (local state only).`);
  }, [addLog, notify]);

  const createSlot = useCallback((data: { name: string; side: "left" | "right" }) => {
    setSlots((all) => [...all, { id: Math.max(...all.map((s) => s.id)) + 1, name: data.name, side: data.side, status: "available", custom: true }]);
    setSlotDialog(false);
    addLog("Created ad slot", data.name);
    notify(`“${data.name}” created at ${SLOT_PRICE}/mo (demo).`);
  }, [addLog, notify]);

  /* ---- moderation ------------------------------------------------------------ */
  const saveReport = useCallback((r: Report) => {
    setReports((all) => all.map((x) => (x.id === r.id ? r : x)));
    setOpenReport(null);
    addLog("Updated report", `${r.type} · ${r.reason}`);
    notify("Report updated (local state only).");
  }, [addLog, notify]);

  /* ---- advertisers / ads ------------------------------------------------------- */
  const toggleSuspendAdvertiser = useCallback((a: Advertiser) => {
    const next = a.status === "active" ? "suspended" : "active";
    setAdvertisers((all) => all.map((x) => (x.id === a.id ? { ...x, status: next } : x)));
    addLog(next === "suspended" ? "Suspended advertiser" : "Reactivated advertiser", a.name, next === "suspended" ? "warning" : "info");
    notify(next === "suspended" ? `${a.name} suspended.` : `${a.name} reactivated.`);
  }, [addLog, notify]);

  const addAdvertiser = useCallback((data: { name: string; contact: string; email: string }) => {
    setAdvertisers((all) => [...all, { id: `a-${Date.now()}`, ...data, registered: todayStamp(), campaigns: 0, status: "active" }]);
    setAdvertiserDialog(false);
    addLog("Added advertiser", data.name);
    notify(`${data.name} added — account is active.`);
  }, [addLog, notify]);

  const setAdStatus = useCallback((id: string, status: AdCreative["status"]) => {
    setAds((all) => all.map((x) => (x.id === id ? { ...x, status } : x)));
    notify(status === "active" ? "Creative restored — now live." : "Creative taken down.");
  }, [notify]);

  /* Creatives publish immediately — there is no approval queue. */
  const addAdvertisement = useCallback((data: { name: string; url: string; slotId: number }) => {
    const slot = slots.find((s) => s.id === data.slotId);
    setAds((all) => [{
      id: `ad-${Date.now()}`, name: data.name, advertiser: "EroAds Media", url: data.url,
      slotId: data.slotId, slotName: slot?.name ?? `Slot ${data.slotId}`,
      period: "1 month", status: "active", thumb: FALLBACK_THUMB,
    }, ...all]);
    setAdDialog(false);
    addLog("Added advertisement", data.name);
    notify(`“${data.name}” is now live.`);
  }, [slots, addLog, notify]);

  /* ---- taxonomy ------------------------------------------------------------------ */
  const savePlaylist = useCallback((p: Playlist, isNew: boolean) => {
    setPlaylists((all) => (isNew ? [p, ...all] : all.map((x) => (x.id === p.id ? p : x))));
    notify(isNew ? `Playlist “${p.name}” created.` : "Playlist saved.");
  }, [notify]);

  /* ---- render ---------------------------------------------------------------------- */
  return (
    <div className="flex h-full bg-void text-ink">
      <aside className="hidden w-60 shrink-0 border-r border-line bg-psidebar lg:block">
        <AdminSidebar active={view} onNavigate={navigate} onSite={onSite} onAdvertise={onAdvertise} />
      </aside>

      {menuOpen && (
        <div className="fixed inset-0 z-[70] lg:hidden">
          <div className="eb-backdrop absolute inset-0 bg-black/60" onClick={() => setMenuOpen(false)} aria-hidden />
          <aside className="eb-panel absolute inset-y-0 left-0 w-64 border-r border-line bg-psidebar">
            <AdminSidebar active={view} onNavigate={navigate} onSite={onSite} onAdvertise={onAdvertise} onClose={() => setMenuOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-psidebar px-4 lg:hidden">
          <button type="button" onClick={() => setMenuOpen(true)} aria-label="Open menu" className="flex h-8 w-8 items-center justify-center rounded-md text-ink-2 hover:bg-white/5 hover:text-ink">
            <Menu className="h-4 w-4" aria-hidden />
          </button>
          <img src={LOGO_URL} alt="erobabe logo" className="h-6 w-auto object-contain" draggable={false} />
          <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-accent">Admin Portal</span>
          <span className="relative ml-auto flex h-8 w-8 items-center justify-center rounded-full border border-accent/40 bg-accent/15 text-[10px] font-bold text-accent">
            AU
            <span className="absolute bottom-0 right-0 h-2 w-2 rounded-full bg-emerald-400 ring-2 ring-void" aria-hidden />
          </span>
        </div>

        <main ref={mainRef} className="center-scroll min-h-0 flex-1 overflow-y-auto">
          <div key={view} className="px-4 pb-10 pt-5 lg:px-6">
            {view === "dashboard" && (
              <DashboardView
                videos={videos}
                slots={slots}
                reports={reports}
                notices={notices}
                advertiserCount={advertisers.length}
                onNavigate={navigate}
                onPreviewVideo={(v) => setVideoDrawer({ video: v, mode: "preview" })}
                onEditVideo={(v) => setVideoDrawer({ video: v, mode: "edit" })}
                onDuplicateVideo={duplicateVideo}
                onToggleVideoStatus={toggleVideoStatus}
                onOpenSlot={setOpenSlot}
                onOpenReport={setOpenReport}
                onQuickAd={() => setAdDialog(true)}
                onQuickSlot={() => setSlotDialog(true)}
                onQuickAdvertiser={() => setAdvertiserDialog(true)}
                onMarkAllRead={() => setNotices((ns) => ns.map((n) => ({ ...n, unread: false })))}
              />
            )}
            {view === "upload" && (
              <UploadView categories={categories} onPublish={publishUpload} />
            )}
            {view === "videos" && (
              <VideosView
                videos={videos}
                categories={categories}
                onNavigate={navigate}
                onUploadClick={() => navigate("upload")}
                onPreview={(v) => setVideoDrawer({ video: v, mode: "preview" })}
                onEdit={(v) => setVideoDrawer({ video: v, mode: "edit" })}
                onDuplicate={duplicateVideo}
                onToggleStatus={toggleVideoStatus}
              />
            )}
            {view === "categories" && (
              <CategoriesView
                categories={categories}
                onAdd={(rec) => { setCategories((c) => [...c, { ...rec, id: `cat-${Date.now()}` }]); notify(`Category “${rec.label}” added.`); }}
                onUpdate={(rec) => { setCategories((all) => all.map((x) => (x.id === rec.id ? rec : x))); notify("Category updated."); }}
                onDelete={(id) => { setCategories((all) => all.filter((x) => x.id !== id)); notify("Category removed."); }}
              />
            )}
            {view === "playlists" && (
              <PlaylistsView
                playlists={playlists}
                videos={videos}
                onSave={savePlaylist}
                onDelete={(id) => { setPlaylists((all) => all.filter((x) => x.id !== id)); notify("Playlist deleted."); }}
              />
            )}
            {view === "ads" && (
              <AdvertisementsView ads={ads} onAddClick={() => setAdDialog(true)} onSetStatus={setAdStatus} />
            )}
            {view === "slots" && (
              <AdSlotsView slots={slots} onOpenSlot={setOpenSlot} onCreateClick={() => setSlotDialog(true)} />
            )}
            {view === "advertisers" && (
              <AdvertisersView advertisers={advertisers} onAddClick={() => setAdvertiserDialog(true)} onToggleSuspend={toggleSuspendAdvertiser} />
            )}
            {view === "campaigns" && <CampaignsView campaigns={INITIAL_CAMPAIGNS} />}
            {view === "payments" && <PaymentsView payments={INITIAL_PAYMENTS} />}
            {view === "reports" && <ReportsView reports={reports} onOpenReport={setOpenReport} />}
            {view === "users" && (
              <UsersView
                users={users}
                onToggleStatus={(u) => {
                  const next = u.status === "active" ? "disabled" : "active";
                  setUsers((all) => all.map((x) => (x.id === u.id ? { ...x, status: next } : x)));
                  addLog(next === "disabled" ? "Disabled account" : "Enabled account", u.name, next === "disabled" ? "warning" : "info");
                  notify(next === "disabled" ? `${u.name} disabled.` : `${u.name} enabled.`);
                }}
              />
            )}
            {view === "settings" && (
              <SettingsView settings={settings} onSave={(s) => { setSettings(s); addLog("Updated settings", "Site configuration"); notify("Settings saved for this session."); }} />
            )}
            {view === "logs" && <LogsView logs={logs} />}
            {view === "health" && <SystemHealthView />}
          </div>
        </main>
      </div>

      {/* overlays */}
      {videoDrawer && (
        <VideoDrawer
          key={`${videoDrawer.video.id}-${videoDrawer.mode}`}
          video={videoDrawer.video}
          categories={categories}
          mode={videoDrawer.mode}
          onClose={() => setVideoDrawer(null)}
          onSave={saveVideo}
          onToggleStatus={toggleVideoStatus}
          onDuplicate={duplicateVideo}
        />
      )}
      {openSlot && <SlotModal key={openSlot.id} slot={openSlot} onClose={() => setOpenSlot(null)} onSave={(s) => { saveSlot(s); setOpenSlot(null); }} />}
      {openReport && <ReportModal report={openReport} onClose={() => setOpenReport(null)} onSave={saveReport} />}
      {adDialog && <AdDialog slots={slots} onClose={() => setAdDialog(false)} onSave={addAdvertisement} />}
      {slotDialog && <CreateSlotDialog onClose={() => setSlotDialog(false)} onSave={createSlot} />}
      {advertiserDialog && <AdvertiserDialog onClose={() => setAdvertiserDialog(false)} onSave={addAdvertiser} />}

      {toast && (
        <div role="status" className="eb-panel fixed bottom-5 right-5 z-[90] flex items-center gap-2.5 rounded-lg border border-line bg-pcard-2 px-4 py-3 shadow-[0_12px_40px_rgba(0,0,0,0.55)]">
          <CircleCheck className="h-4 w-4 shrink-0 text-emerald-400" aria-hidden />
          <span className="text-[12.5px] font-medium text-ink">{toast}</span>
        </div>
      )}
    </div>
  );
}
