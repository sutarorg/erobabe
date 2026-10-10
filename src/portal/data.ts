/* ------------------------------------------------------------------ */
/* Erobabe Advertiser Portal — local mock data (no backend)            */
/* ------------------------------------------------------------------ */

import { LOGO_URL } from "../data/content";

export { LOGO_URL };

/* ------------------------------- types ----------------------------- */

export type SlotStatus = "active" | "available";

export interface Slot {
  id: number;
  name: string;
  side: "left" | "right";
  status: SlotStatus;
  advertiser?: string;
  mine?: boolean;
  campaignName?: string;
  start?: string;
  end?: string;
  estImpr: string;
  ctr: string;
}

export type CampaignStatus = "active" | "pending" | "completed" | "rejected" | "paused";

export interface Campaign {
  id: string;
  name: string;
  slotId: number;
  placement: string;
  status: CampaignStatus;
  start: string;
  end: string;
  impressions: string;
  clicks: string;
  ctr: string;
  spend: number;
  progress: number;
  thumb: string;
  note?: string;
}

export interface Transaction {
  id: string;
  date: string;
  desc: string;
  type: "topup" | "payment";
  amount: number;
  method: string;
  status: string;
}

export interface Invoice {
  id: string;
  date: string;
  desc: string;
  amount: number;
  status: "Paid" | "Pending";
}

export interface Notice {
  id: string;
  title: string;
  body: string;
  time: string;
  unread: boolean;
}

export interface PerfSeries {
  impr: number[];
  clicks: number[];
  labels: string[];
  totalImpr: string;
  totalClicks: string;
}

export interface Profile {
  company: string;
  contact: string;
  email: string;
  website: string;
  country: string;
}

/* --------------------------- helpers ------------------------------ */

const px = (id: number) =>
  `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200`;

export const FALLBACK_THUMB = px(38074638);

export const SLOT_PRICE = 99;

export const fmtUSD = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export const fmtShort = (d: Date) => `${MONTHS[d.getMonth()]} ${String(d.getDate()).padStart(2, "0")}`;
export const fmtLong = (d: Date) => `${fmtShort(d)}, ${d.getFullYear()}`;

export function rangeFrom(start: Date, months: number): { start: string; end: string } {
  const end = new Date(start);
  end.setDate(end.getDate() + months * 30);
  return { start: fmtLong(start), end: fmtLong(end) };
}

export function invoiceId(seq: number) {
  return `INV-${2042 + seq}`;
}

/* ------------------------------ slots ------------------------------ */

export const INITIAL_SLOTS: Slot[] = [
  { id: 1, name: "Left Sidebar Top", side: "left", status: "active", advertiser: "EroAds Media", mine: true, campaignName: "EroX Promo", start: "Dec 01", end: "Dec 30", estImpr: "52K", ctr: "1.8%" },
  { id: 2, name: "Left Sidebar 2", side: "left", status: "available", estImpr: "47K", ctr: "1.5%" },
  { id: 3, name: "Left Sidebar 3", side: "left", status: "active", advertiser: "VelvetAds Co.", start: "Dec 05", end: "Jan 04", estImpr: "49K", ctr: "1.7%" },
  { id: 4, name: "Left Sidebar 4", side: "left", status: "available", estImpr: "44K", ctr: "1.4%" },
  { id: 5, name: "Left Sidebar Bottom", side: "left", status: "active", advertiser: "EroAds Media", mine: true, campaignName: "SeduceX", start: "Dec 03", end: "Jan 02", estImpr: "41K", ctr: "1.6%" },
  { id: 6, name: "Right Sidebar Top", side: "right", status: "active", advertiser: "EroAds Media", mine: true, campaignName: "Luxe Desire", start: "Dec 10", end: "Jan 09", estImpr: "53K", ctr: "1.9%" },
  { id: 7, name: "Right Sidebar 2", side: "right", status: "available", estImpr: "46K", ctr: "1.5%" },
  { id: 8, name: "Right Sidebar 3", side: "right", status: "active", advertiser: "NeonMedia", start: "Dec 12", end: "Jan 11", estImpr: "48K", ctr: "1.6%" },
  { id: 9, name: "Right Sidebar 4", side: "right", status: "available", estImpr: "43K", ctr: "1.3%" },
  { id: 10, name: "Right Sidebar Bottom", side: "right", status: "available", estImpr: "40K", ctr: "1.2%" },
];

/* ---------------------------- campaigns ---------------------------- */

export const INITIAL_CAMPAIGNS: Campaign[] = [
  {
    id: "cmp-wild", name: "Wild Secrets", slotId: 2, placement: "Left Sidebar 2",
    status: "pending", start: "Submitted Dec 14, 2026", end: "Awaiting approval",
    impressions: "—", clicks: "—", ctr: "—", spend: 0, progress: 0, thumb: px(6537115),
    note: "Creative under review. Campaigns typically go live within 24 hours.",
  },
  {
    id: "cmp-luxe", name: "Luxe Desire", slotId: 6, placement: "Right Sidebar Top",
    status: "active", start: "Dec 10, 2026", end: "Jan 09, 2027",
    impressions: "211.6K", clicks: "3.3K", ctr: "1.56%", spend: 99, progress: 33, thumb: px(10442969),
  },
  {
    id: "cmp-seduce", name: "SeduceX", slotId: 5, placement: "Left Sidebar Bottom",
    status: "active", start: "Dec 03, 2026", end: "Jan 02, 2027",
    impressions: "188.6K", clicks: "2.9K", ctr: "1.54%", spend: 99, progress: 43, thumb: px(7277907),
  },
  {
    id: "cmp-erox", name: "EroX Promo", slotId: 1, placement: "Left Sidebar Top",
    status: "active", start: "Dec 01, 2026", end: "Dec 30, 2026",
    impressions: "412.2K", clicks: "6.4K", ctr: "1.55%", spend: 99, progress: 50, thumb: px(24407296),
  },
  {
    id: "cmp-velvet", name: "Velvet Nights", slotId: 3, placement: "Left Sidebar 3",
    status: "completed", start: "Nov 01, 2026", end: "Nov 30, 2026",
    impressions: "348.9K", clicks: "5.1K", ctr: "1.46%", spend: 99, progress: 100, thumb: px(10442969),
  },
  {
    id: "cmp-afterglow", name: "Afterglow", slotId: 8, placement: "Right Sidebar 3",
    status: "completed", start: "Oct 15, 2026", end: "Nov 15, 2026",
    impressions: "296.3K", clicks: "4.2K", ctr: "1.42%", spend: 99, progress: 100, thumb: px(7277907),
  },
  {
    id: "cmp-midnight", name: "Midnight Banner", slotId: 7, placement: "Right Sidebar 2",
    status: "rejected", start: "Rejected Nov 09, 2026", end: "—",
    impressions: "—", clicks: "—", ctr: "—", spend: 0, progress: 0, thumb: px(6537115),
    note: "Creative rejected — please review the 18+ imagery guidelines.",
  },
];

/* --------------------------- billing ------------------------------- */

export const INITIAL_TRANSACTIONS: Transaction[] = [
  { id: "tx1", date: "Dec 12, 2026", desc: "Campaign payment — Slot 6 · Luxe Desire", type: "payment", amount: -99, method: "Wallet", status: "Completed" },
  { id: "tx2", date: "Dec 08, 2026", desc: "Wallet top-up — Visa •••• 4242", type: "topup", amount: 942.8, method: "Visa •••• 4242", status: "Completed" },
  { id: "tx3", date: "Dec 06, 2026", desc: "Campaign payment — Slot 5 · SeduceX", type: "payment", amount: -99, method: "Wallet", status: "Completed" },
  { id: "tx4", date: "Dec 03, 2026", desc: "Campaign payment — Slot 1 · EroX Promo", type: "payment", amount: -99, method: "Wallet", status: "Completed" },
  { id: "tx5", date: "Nov 25, 2026", desc: "Wallet top-up — Visa •••• 4242", type: "topup", amount: 600, method: "Visa •••• 4242", status: "Completed" },
];

export const INITIAL_WALLET = 1245.8;
export const INITIAL_SPENT = 297;

export const INITIAL_INVOICES: Invoice[] = [
  { id: "INV-2041", date: "Dec 12, 2026", desc: "Slot 6 reservation — 1 month", amount: 99, status: "Paid" },
  { id: "INV-2040", date: "Dec 06, 2026", desc: "Slot 5 reservation — 1 month", amount: 99, status: "Paid" },
  { id: "INV-2039", date: "Dec 03, 2026", desc: "Slot 1 reservation — 1 month", amount: 99, status: "Paid" },
  { id: "INV-2038", date: "Dec 08, 2026", desc: "Wallet top-up", amount: 942.8, status: "Paid" },
  { id: "INV-2037", date: "Nov 25, 2026", desc: "Wallet top-up", amount: 600, status: "Paid" },
  { id: "INV-2036", date: "Nov 12, 2026", desc: "Slot 5 reservation — 1 month", amount: 99, status: "Paid" },
];

/* ------------------------- notifications --------------------------- */

export const INITIAL_NOTICES: Notice[] = [
  { id: "n1", title: "Luxe Desire is live", body: "Your campaign started delivering impressions on Slot 6.", time: "2h ago", unread: true },
  { id: "n2", title: "Weekly report ready", body: "Nov 30 – Dec 06 performance summary is available.", time: "1d ago", unread: true },
  { id: "n3", title: "Top-up confirmed", body: "$942.80 was added to your wallet balance.", time: "4d ago", unread: true },
  { id: "n4", title: "SeduceX is live", body: "Your campaign started delivering impressions on Slot 5.", time: "1w ago", unread: false },
];

/* ---------------------------- analytics ---------------------------- */

const dayLabels = (prefix: string) =>
  Array.from({ length: 12 }, (_, i) => (i % 3 === 0 || i === 11 ? `${prefix} ${i + 1}` : ""));

export const PERF: Record<string, PerfSeries> = {
  month: {
    impr: [42, 55, 48, 62, 70, 64, 78, 85, 72, 90, 96, 88],
    clicks: [0.7, 0.9, 0.8, 1.0, 1.2, 1.1, 1.3, 1.4, 1.2, 1.5, 1.6, 1.4],
    labels: dayLabels("Dec"),
    totalImpr: "812.4K",
    totalClicks: "12.6K",
  },
  last: {
    impr: [38, 41, 46, 44, 52, 58, 55, 61, 66, 63, 70, 74],
    clicks: [0.6, 0.7, 0.8, 0.7, 0.9, 1.0, 0.9, 1.1, 1.2, 1.1, 1.3, 1.3],
    labels: dayLabels("Nov"),
    totalImpr: "694.1K",
    totalClicks: "10.1K",
  },
  qtr: {
    impr: [180, 195, 170, 210, 225, 240, 215, 250, 270, 260, 285, 310],
    clicks: [2.9, 3.1, 2.7, 3.4, 3.6, 3.8, 3.5, 4.0, 4.3, 4.1, 4.5, 4.8],
    labels: Array.from({ length: 12 }, (_, i) => (i % 3 === 0 || i === 11 ? `W${i + 1}` : "")),
    totalImpr: "2.31M",
    totalClicks: "34.2K",
  },
};

export const TOP_SLOTS = [
  { name: "Slot 1 · Left Sidebar Top", value: "212K", pct: 88 },
  { name: "Slot 6 · Right Sidebar Top", value: "148K", pct: 62 },
  { name: "Slot 5 · Left Sidebar Bottom", value: "121K", pct: 50 },
  { name: "Slot 3 · Left Sidebar 3", value: "96K", pct: 40 },
];

export const TRAFFIC_SOURCES = [
  { name: "Direct", pct: 54 },
  { name: "Referrals", pct: 27 },
  { name: "Social", pct: 19 },
];

/* ----------------------------- profile ----------------------------- */

export const INITIAL_PROFILE: Profile = {
  company: "EroAds Media",
  contact: "Alex Morgan",
  email: "ads@eroads.media",
  website: "https://eroads.media",
  country: "United States",
};

/* ------------------------------- FAQ ------------------------------- */

export const FAQS = [
  {
    q: "How do I reserve an ad slot?",
    a: "Pick any placement marked Available, open its details and confirm the reservation. Slots are a flat $99 per month, billed from your wallet balance instantly.",
  },
  {
    q: "When does my campaign go live?",
    a: "After reservation, creatives are reviewed within 24 hours. Approved campaigns start delivering impressions immediately after approval.",
  },
  {
    q: "What creatives are allowed?",
    a: "Use a 16:9 image, ideally 1200×675 PNG or JPG under 5MB. All depicted persons must be adults (18+). Explicit content is moderated per our guidelines.",
  },
  {
    q: "Can I pause or cancel a campaign?",
    a: "Yes. Pause anytime from My Campaigns. Reservations cancelled within the first 48 hours receive a prorated wallet refund.",
  },
  {
    q: "How are impressions counted?",
    a: "We count a viewable impression when at least 50% of the creative is visible for one continuous second, deduplicated per visitor per day.",
  },
];
