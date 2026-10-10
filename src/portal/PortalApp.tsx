import { CircleCheck, Menu } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { ProfileView, SupportView } from "./AccountViews";
import AnalyticsView from "./AnalyticsView";
import { InvoicesView, PaymentsView } from "./BillingViews";
import CampaignsView from "./CampaignsView";
import CreateCampaignView, { type NewCampaignPayload } from "./CreateCampaignView";
import DashboardView from "./DashboardView";
import {
  FALLBACK_THUMB,
  LOGO_URL,
  fmtLong,
  fmtShort,
  fmtUSD,
  INITIAL_CAMPAIGNS,
  INITIAL_INVOICES,
  INITIAL_NOTICES,
  INITIAL_PROFILE,
  INITIAL_SLOTS,
  INITIAL_SPENT,
  INITIAL_TRANSACTIONS,
  INITIAL_WALLET,
  invoiceId,
  rangeFrom,
  SLOT_PRICE,
  type Campaign,
  type Invoice,
  type Notice,
  type Profile,
  type Slot,
  type Transaction,
} from "./data";
import { AddFundsModal, CampaignModal } from "./Modals";
import Sidebar, { type PortalView } from "./Sidebar";
import SlotDrawer from "./SlotDrawer";
import SlotsView from "./SlotsView";

/** URL sub-path ⇄ portal view. */
const PATH_TO_VIEW: Record<string, PortalView> = {
  "": "dashboard",
  dashboard: "dashboard",
  slots: "slots",
  campaigns: "campaigns",
  createcampaign: "create",
  payments: "payments",
  invoices: "invoices",
  analytics: "analytics",
  profile: "profile",
  support: "support",
};

const VIEW_TO_PATH: Record<PortalView, string> = {
  dashboard: "",
  slots: "slots",
  campaigns: "campaigns",
  create: "createcampaign",
  payments: "payments",
  invoices: "invoices",
  analytics: "analytics",
  profile: "profile",
  support: "support",
};

interface PortalAppProps {
  path?: string;
  onRoute?: (path: string) => void;
  onExit: () => void;
}

export default function PortalApp({ path = "", onRoute, onExit }: PortalAppProps) {
  /* ---- navigation ------------------------------------------------- */
  const view = PATH_TO_VIEW[path] ?? "dashboard";
  const [menuOpen, setMenuOpen] = useState(false);
  const mainRef = useRef<HTMLElement>(null);

  /* ---- shared mock state ------------------------------------------- */
  const [slots, setSlots] = useState<Slot[]>(INITIAL_SLOTS);
  const [campaigns, setCampaigns] = useState<Campaign[]>(INITIAL_CAMPAIGNS);
  const [transactions, setTransactions] = useState<Transaction[]>(INITIAL_TRANSACTIONS);
  const [invoices, setInvoices] = useState<Invoice[]>(INITIAL_INVOICES);
  const [notices, setNotices] = useState<Notice[]>(INITIAL_NOTICES);
  const [profile, setProfile] = useState<Profile>(INITIAL_PROFILE);
  const [wallet, setWallet] = useState(INITIAL_WALLET);
  const [spent, setSpent] = useState(INITIAL_SPENT);

  /* ---- overlays ----------------------------------------------------- */
  const [openSlot, setOpenSlot] = useState<Slot | null>(null);
  const [openCampaign, setOpenCampaign] = useState<Campaign | null>(null);
  const [addFunds, setAddFunds] = useState(false);

  /* ---- toast --------------------------------------------------------- */
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);
  const notify = useCallback((message: string) => {
    window.clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = window.setTimeout(() => setToast(null), 3400);
  }, []);

  const navigate = useCallback(
    (next: PortalView) => {
      onRoute?.(VIEW_TO_PATH[next]);
      setMenuOpen(false);
      mainRef.current?.scrollTo({ top: 0 });
    },
    [onRoute]
  );

  /* ---- billing helper ------------------------------------------------- */
  const chargeWallet = useCallback(
    (amount: number, desc: string, invoiceDesc: string, months: number) => {
      const now = new Date();
      setWallet((w) => w - amount);
      setSpent((s) => s + amount);
      setTransactions((txs) => [
        {
          id: `tx-${now.getTime()}`,
          date: fmtLong(now),
          desc,
          type: "payment",
          amount: -amount,
          method: "Wallet",
          status: "Completed",
        },
        ...txs,
      ]);
      setInvoices((invs) => [
        {
          id: invoiceId(invs.length),
          date: fmtLong(now),
          desc: `${invoiceDesc} — ${months} month${months > 1 ? "s" : ""}`,
          amount,
          status: "Paid",
        },
        ...invs,
      ]);
    },
    []
  );

  /* ---- quick reservation (from slot drawer) ---------------------------- */
  const reserveSlot = useCallback(
    (slotId: number) => {
      const slot = slots.find((s) => s.id === slotId);
      if (!slot || slot.status !== "available") return;
      const now = new Date();
      const range = rangeFrom(now, 1);
      const end = new Date(now);
      end.setDate(end.getDate() + 30);
      setSlots((all) =>
        all.map((s) =>
          s.id === slotId
            ? {
                ...s,
                status: "active",
                advertiser: profile.company,
                mine: true,
                campaignName: `Slot ${slotId} Placement`,
                start: fmtShort(now),
                end: fmtShort(end),
              }
            : s
        )
      );
      setCampaigns((cs) => [
        {
          id: `cmp-${now.getTime()}`,
          name: `Slot ${slotId} Placement`,
          slotId,
          placement: slot.name,
          status: "active",
          start: range.start,
          end: range.end,
          impressions: "0",
          clicks: "0",
          ctr: "—",
          spend: SLOT_PRICE,
          progress: 0,
          thumb: FALLBACK_THUMB,
        },
        ...cs,
      ]);
      chargeWallet(SLOT_PRICE, `Campaign payment — Slot ${slotId}`, `Slot ${slotId} reservation`, 1);
      notify(`Slot ${slotId} reserved — demo confirmation.`);
    },
    [slots, profile.company, chargeWallet, notify]
  );

  /* ---- campaign creation ---------------------------------------------- */
  const createCampaign = useCallback(
    (payload: NewCampaignPayload) => {
      const slot = slots.find((s) => s.id === payload.slotId);
      const now = new Date();
      const total = SLOT_PRICE * payload.months;
      const end = new Date(now);
      end.setDate(end.getDate() + payload.months * 30);
      setSlots((all) =>
        all.map((s) =>
          s.id === payload.slotId
            ? {
                ...s,
                status: "active",
                advertiser: profile.company,
                mine: true,
                campaignName: payload.name,
                start: fmtShort(now),
                end: fmtShort(end),
              }
            : s
        )
      );
      setCampaigns((cs) => [
        {
          id: `cmp-${now.getTime()}`,
          name: payload.name,
          slotId: payload.slotId,
          placement: slot?.name ?? `Slot ${payload.slotId}`,
          status: "pending",
          start: `Submitted ${fmtLong(now)}`,
          end: "Awaiting approval",
          impressions: "—",
          clicks: "—",
          ctr: "—",
          spend: total,
          progress: 0,
          thumb: payload.creativePreview ?? FALLBACK_THUMB,
          note: `Reservation confirmed (${fmtUSD(total)} · ${payload.months} month${
            payload.months > 1 ? "s" : ""
          }). Creative under review — campaigns typically go live within 24 hours. Destination: ${payload.url}`,
        },
        ...cs,
      ]);
      chargeWallet(total, `Campaign reservation — Slot ${payload.slotId} · ${payload.name}`, `Slot ${payload.slotId} reservation`, payload.months);
      notify("Campaign submitted for review (demo).");
    },
    [slots, profile.company, chargeWallet, notify]
  );

  /* ---- campaign pause / resume ------------------------------------------ */
  const togglePause = useCallback(
    (campaign: Campaign) => {
      setCampaigns((cs) =>
        cs.map((c) =>
          c.id === campaign.id
            ? { ...c, status: c.status === "active" ? "paused" : "active" }
            : c
        )
      );
      setOpenCampaign((cur) =>
        cur && cur.id === campaign.id
          ? { ...cur, status: cur.status === "active" ? "paused" : "active" }
          : cur
      );
      notify(
        campaign.status === "active"
          ? `${campaign.name} paused (demo).`
          : `${campaign.name} resumed (demo).`
      );
    },
    [notify]
  );

  /* ---- wallet top-up ----------------------------------------------------- */
  const confirmAddFunds = useCallback(
    (amount: number) => {
      const now = new Date();
      setWallet((w) => w + amount);
      setTransactions((txs) => [
        {
          id: `tx-${now.getTime()}`,
          date: fmtLong(now),
          desc: "Wallet top-up — Visa •••• 4242",
          type: "topup",
          amount,
          method: "Visa •••• 4242",
          status: "Completed",
        },
        ...txs,
      ]);
      notify(`${fmtUSD(amount)} added to your wallet (demo).`);
    },
    [notify]
  );

  const markAllRead = useCallback(() => {
    setNotices((ns) => ns.map((n) => ({ ...n, unread: false })));
  }, []);

  return (
    <div className="flex h-full bg-void text-ink">
      {/* desktop sidebar */}
      <aside className="hidden w-60 shrink-0 border-r border-line bg-psidebar lg:block">
        <Sidebar active={view} onNavigate={navigate} onLogout={onExit} />
      </aside>

      {/* mobile sidebar drawer */}
      {menuOpen && (
        <div className="fixed inset-0 z-[70] lg:hidden">
          <div className="eb-backdrop absolute inset-0 bg-black/60" onClick={() => setMenuOpen(false)} aria-hidden />
          <aside className="eb-panel absolute inset-y-0 left-0 w-64 border-r border-line bg-psidebar">
            <Sidebar active={view} onNavigate={navigate} onLogout={onExit} onClose={() => setMenuOpen(false)} />
          </aside>
        </div>
      )}

      {/* main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* mobile top bar */}
        <div className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-psidebar px-4 lg:hidden">
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            aria-label="Open menu"
            className="flex h-8 w-8 items-center justify-center rounded-md text-ink-2 hover:bg-white/5 hover:text-ink"
          >
            <Menu className="h-4 w-4" aria-hidden />
          </button>
          <img src={LOGO_URL} alt="erobabe logo" className="h-6 w-auto object-contain" draggable={false} />
          <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-accent">
            Advertiser Portal
          </span>
          <span className="ml-auto flex h-8 w-8 items-center justify-center rounded-full border border-accent/40 bg-accent/15 text-[10px] font-bold text-accent">
            {profile.company.split(" ").map((w) => w[0]).slice(0, 2).join("")}
          </span>
        </div>

        <main ref={mainRef} className="center-scroll min-h-0 flex-1 overflow-y-auto">
          <div key={view} className="px-4 pb-10 pt-5 lg:px-6">
            {view === "dashboard" && (
              <DashboardView
                profile={profile}
                wallet={wallet}
                spent={spent}
                slots={slots}
                campaigns={campaigns}
                notices={notices}
                onNavigate={navigate}
                onOpenSlot={setOpenSlot}
                onOpenCampaign={setOpenCampaign}
                onAddFunds={() => setAddFunds(true)}
                onMarkAllRead={markAllRead}
              />
            )}
            {view === "slots" && <SlotsView slots={slots} onOpenSlot={setOpenSlot} />}
            {view === "campaigns" && (
              <CampaignsView
                campaigns={campaigns}
                onOpenCampaign={setOpenCampaign}
                onTogglePause={togglePause}
                onNavigate={navigate}
              />
            )}
            {view === "create" && (
              <CreateCampaignView
                slots={slots}
                wallet={wallet}
                onSubmit={createCampaign}
                onNavigate={navigate}
                onAddFunds={() => setAddFunds(true)}
              />
            )}
            {view === "payments" && (
              <PaymentsView wallet={wallet} transactions={transactions} onAddFunds={() => setAddFunds(true)} />
            )}
            {view === "invoices" && <InvoicesView invoices={invoices} />}
            {view === "analytics" && <AnalyticsView />}
            {view === "profile" && (
              <ProfileView
                profile={profile}
                onSave={(p) => {
                  setProfile(p);
                  notify("Profile saved (demo).");
                }}
              />
            )}
            {view === "support" && <SupportView onNotify={notify} />}
          </div>
        </main>
      </div>

      {/* overlays */}
      {openSlot && (
        <SlotDrawer
          key={openSlot.id}
          slot={openSlot}
          wallet={wallet}
          onClose={() => setOpenSlot(null)}
          onReserve={reserveSlot}
          onAddFunds={() => {
            setOpenSlot(null);
            setAddFunds(true);
          }}
          onNotify={notify}
        />
      )}
      {openCampaign && (
        <CampaignModal
          campaign={openCampaign}
          onClose={() => setOpenCampaign(null)}
          onTogglePause={togglePause}
        />
      )}
      {addFunds && (
        <AddFundsModal wallet={wallet} onClose={() => setAddFunds(false)} onConfirm={confirmAddFunds} />
      )}

      {/* toast */}
      {toast && (
        <div
          role="status"
          className="eb-panel fixed bottom-5 right-5 z-[90] flex items-center gap-2.5 rounded-lg border border-line bg-pcard-2 px-4 py-3 shadow-[0_12px_40px_rgba(0,0,0,0.55)]"
        >
          <CircleCheck className="h-4 w-4 shrink-0 text-emerald-400" aria-hidden />
          <span className="text-[12.5px] font-medium text-ink">{toast}</span>
        </div>
      )}
    </div>
  );
}
