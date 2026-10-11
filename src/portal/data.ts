/* ------------------------------------------------------------------ */
/* Erobabe Advertiser Portal — production types (no mock)              */
/* ------------------------------------------------------------------ */

import { LOGO_URL } from "../data/content";
export { LOGO_URL };

export type SlotStatus = "active" | "available" | "reserved";
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

export type CampaignStatus = "active" | "pending" | "completed" | "rejected" | "paused" | "pending_payment" | "pending_review";
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
  status: "Paid" | "Pending" | "Failed";
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

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
export const fmtUSD = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
export const fmtShort = (d: Date) => `${MONTHS[d.getMonth()]} ${String(d.getDate()).padStart(2, "0")}`;
export const fmtLong = (d: Date) => `${fmtShort(d)}, ${d.getFullYear()}`;
export function rangeFrom(start: Date, months: number): { start: string; end: string } {
  const end = new Date(start);
  end.setDate(end.getDate() + months * 30);
  return { start: fmtLong(start), end: fmtLong(end) };
}
export function invoiceId(seq: number) { return `INV-${2042 + seq}`; }

export const FALLBACK_THUMB = LOGO_URL;
export const SLOT_PRICE = 99;

// Production — empty states, no fake data
export const INITIAL_SLOTS: Slot[] = [
  { id: 1, name: "Left Sidebar Top", side: "left", status: "available", estImpr: "—", ctr: "—" },
  { id: 2, name: "Left Sidebar 2", side: "left", status: "available", estImpr: "—", ctr: "—" },
  { id: 3, name: "Left Sidebar 3", side: "left", status: "available", estImpr: "—", ctr: "—" },
  { id: 4, name: "Left Sidebar 4", side: "left", status: "available", estImpr: "—", ctr: "—" },
  { id: 5, name: "Left Sidebar Bottom", side: "left", status: "available", estImpr: "—", ctr: "—" },
  { id: 6, name: "Right Sidebar Top", side: "right", status: "available", estImpr: "—", ctr: "—" },
  { id: 7, name: "Right Sidebar 2", side: "right", status: "available", estImpr: "—", ctr: "—" },
  { id: 8, name: "Right Sidebar 3", side: "right", status: "available", estImpr: "—", ctr: "—" },
  { id: 9, name: "Right Sidebar 4", side: "right", status: "available", estImpr: "—", ctr: "—" },
  { id: 10, name: "Right Sidebar Bottom", side: "right", status: "available", estImpr: "—", ctr: "—" },
];

export const INITIAL_CAMPAIGNS: Campaign[] = [];
export const INITIAL_TRANSACTIONS: Transaction[] = [];
export const INITIAL_WALLET = 0;
export const INITIAL_SPENT = 0;
export const INITIAL_INVOICES: Invoice[] = [];
export const INITIAL_NOTICES: Notice[] = [];

export const PERF: Record<string, PerfSeries> = {
  month: { impr: [], clicks: [], labels: [], totalImpr: "0", totalClicks: "0" },
  last: { impr: [], clicks: [], labels: [], totalImpr: "0", totalClicks: "0" },
  qtr: { impr: [], clicks: [], labels: [], totalImpr: "0", totalClicks: "0" },
};

export const TOP_SLOTS: any[] = [];
export const TRAFFIC_SOURCES: any[] = [];

export const INITIAL_PROFILE: Profile = {
  company: "",
  contact: "",
  email: "",
  website: "",
  country: "",
};

export const FAQS = [
  { q: "How do I reserve an ad slot?", a: "Pick any placement marked Available, create campaign, complete crypto payment via NOWPayments, wait for creative approval." },
  { q: "When does my campaign go live?", a: "After payment confirmed (2 blockchain confirmations) and creative approved." },
  { q: "What creatives are allowed?", a: "16:9 image, 1200×675 PNG/JPG/WebP under 5MB. All persons must be adults (18+)." },
  { q: "Can I pause or cancel?", a: "Pause anytime. Cancellation within 48h may receive prorated refund per business policy." },
  { q: "How are impressions counted?", a: "Viewable impression when 50% visible for 1s, deduplicated per visitor per day — real tracking." },
];
