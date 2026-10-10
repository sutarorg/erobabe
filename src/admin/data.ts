/* ------------------------------------------------------------------ */
/* Erobabe Admin Portal — local mock data (no backend anywhere)        */
/* ------------------------------------------------------------------ */

export type VideoStatus = "published" | "processing" | "draft" | "unpublished";

export interface AdminVideo {
  id: string;
  title: string;
  category: string;
  status: VideoStatus;
  views: string;
  duration: string;
  uploaded: string;
  quality: "4K" | "HD";
  thumb: string;
  description: string;
  tags: string[];
}

export interface AdminSlot {
  id: number;
  name: string;
  side: "left" | "right";
  status: "active" | "available";
  advertiser?: string;
  campaignName?: string;
  start?: string;
  end?: string;
  custom?: boolean;
}

export interface AdCreative {
  id: string;
  name: string;
  advertiser: string;
  url: string;
  slotId: number;
  slotName: string;
  period: string;
  /** Creatives go live immediately — advertisers self-serve without approval. */
  status: "active" | "rejected";
  thumb: string;
}

export interface Advertiser {
  id: string;
  name: string;
  contact: string;
  email: string;
  registered: string;
  campaigns: number;
  /** Accounts are active on sign-up — no admin approval step. */
  status: "active" | "suspended";
}

export interface AdminCampaign {
  id: string;
  name: string;
  advertiser: string;
  placement: string;
  start: string;
  end: string;
  /** Campaigns start delivering as soon as they are booked. */
  status: "active" | "paused" | "completed";
  price: number;
  impressions: string;
  clicks: string;
}

export interface Payment {
  id: string;
  advertiser: string;
  desc: string;
  amount: number;
  method: string;
  date: string;
  status: "paid" | "pending" | "failed";
}

export interface Report {
  id: string;
  type: "Video" | "Advertisement" | "Advertiser";
  reason: string;
  content: string;
  reportedBy: string;
  date: string;
  status: "new" | "in-review" | "resolved";
  note?: string;
}

export interface UserAccount {
  id: string;
  name: string;
  email: string;
  role: "Administrator" | "Moderator" | "Advertiser" | "Member";
  status: "active" | "disabled";
  joined: string;
}

export interface LogEntry {
  id: string;
  time: string;
  actor: string;
  action: string;
  target: string;
  level: "info" | "warning" | "error";
}

export interface Playlist {
  id: string;
  name: string;
  desc: string;
  videoIds: string[];
  updated: string;
}

export interface CategoryRec {
  id: string;
  label: string;
  icon: string;
  videos: number;
}

export interface PendingVideo {
  id: string;
  title: string;
  category: string;
  thumb: string;
  submitted: string;
  uploader: string;
}

export interface PendingAd {
  id: string;
  advertiser: string;
  slotId: number;
  slotName: string;
  url: string;
  duration: string;
  thumb: string;
}

export interface PendingAdvertiser {
  id: string;
  name: string;
  contact: string;
  email: string;
  registered: string;
}

export interface Notice {
  id: string;
  title: string;
  body: string;
  time: string;
  unread: boolean;
}

/* --------------------------- helpers ------------------------------ */

const px = (id: number) =>
  `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200`;

export const FALLBACK_THUMB = px(38074638);
export const SLOT_PRICE = 99;
export const fmtUSD = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });

/* ---------------------------- videos ------------------------------- */

const desc = (t: string) =>
  `${t} — premium editorial scene from the Erobabe library. Tasteful, non-explicit preview metadata for the admin demo.`;

export const INITIAL_VIDEOS: AdminVideo[] = [
  { id: "v01", title: "Late Night Temptation", category: "Mature", status: "published", views: "128.4K", duration: "24:08", uploaded: "Dec 14, 2026 · 09:24", quality: "4K", thumb: px(24407296), description: desc("Late-night editorial scene"), tags: ["featured", "editorial", "4k"] },
  { id: "v02", title: "Morning Desire", category: "Couples", status: "published", views: "98.2K", duration: "18:42", uploaded: "Dec 14, 2026 · 08:10", quality: "4K", thumb: px(10442969), description: desc("A slow morning study"), tags: ["couples", "soft light"] },
  { id: "v03", title: "Sensual Moments", category: "Lesbian", status: "published", views: "212.7K", duration: "21:15", uploaded: "Dec 13, 2026 · 22:41", quality: "HD", thumb: px(38074638), description: desc("Boudoir portrait series"), tags: ["boudoir", "featured"] },
  { id: "v04", title: "After Dark", category: "Kinky", status: "processing", views: "—", duration: "27:33", uploaded: "Dec 13, 2026 · 21:05", quality: "4K", thumb: px(7277907), description: desc("Crimson-lit night session"), tags: ["neon", "4k"] },
  { id: "v05", title: "Weekend Vibes", category: "Amateur", status: "draft", views: "—", duration: "16:44", uploaded: "Dec 13, 2026 · 18:32", quality: "HD", thumb: px(29011561), description: desc("Golden-hour getaway"), tags: ["sunset", "penthouse"] },
  { id: "v06", title: "Private Session", category: "POV", status: "unpublished", views: "64.1K", duration: "19:56", uploaded: "Dec 12, 2026 · 23:48", quality: "HD", thumb: px(17553416), description: desc("Monochrome confessionals"), tags: ["b&w", "pov"] },
  { id: "v07", title: "Crimson Whisper", category: "Kinky", status: "published", views: "87.9K", duration: "22:47", uploaded: "Dec 12, 2026 · 20:14", quality: "4K", thumb: px(736415), description: desc("Old-Hollywood glamour"), tags: ["glamour", "velvet"] },
  { id: "v08", title: "Velvet Touch", category: "Mature 18+", status: "published", views: "145.3K", duration: "19:08", uploaded: "Dec 11, 2026 · 17:52", quality: "HD", thumb: px(38500521), description: desc("Refined and unhurried"), tags: ["luxury"] },
  { id: "v09", title: "Secret Rendezvous", category: "Couples", status: "draft", views: "—", duration: "26:54", uploaded: "Dec 11, 2026 · 15:36", quality: "4K", thumb: px(6537115), description: desc("Rooftop city encounter"), tags: ["city", "b&w"] },
  { id: "v10", title: "Golden Hour", category: "Amateur", status: "published", views: "73.3K", duration: "14:31", uploaded: "Dec 10, 2026 · 19:08", quality: "HD", thumb: px(14541510), description: desc("Last light over the skyline"), tags: ["sunset"] },
  { id: "v11", title: "Neon Nights", category: "Mature", status: "processing", views: "—", duration: "23:12", uploaded: "Dec 10, 2026 · 14:27", quality: "4K", thumb: px(19186315), description: desc("After-hours lounge portrait"), tags: ["neon", "4k"] },
  { id: "v12", title: "The Regency Suite", category: "Mature 18+", status: "unpublished", views: "52.6K", duration: "25:40", uploaded: "Dec 09, 2026 · 16:45", quality: "HD", thumb: px(9140302), description: desc("Silk and shadow study"), tags: ["suite", "b&w"] },
];

/* ----------------------------- slots ------------------------------- */

export const INITIAL_SLOTS: AdminSlot[] = [
  { id: 1, name: "Left Sidebar Top", side: "left", status: "active", advertiser: "EroAds Media", campaignName: "EroX Promo", start: "Dec 01", end: "Dec 30" },
  { id: 2, name: "Left Sidebar 2", side: "left", status: "available" },
  { id: 3, name: "Left Sidebar 3", side: "left", status: "active", advertiser: "VelvetAds Co.", campaignName: "Velvet Nights", start: "Dec 05", end: "Jan 04" },
  { id: 4, name: "Left Sidebar 4", side: "left", status: "available" },
  { id: 5, name: "Left Sidebar Bottom", side: "left", status: "active", advertiser: "EroAds Media", campaignName: "SeduceX", start: "Dec 03", end: "Jan 02" },
  { id: 6, name: "Right Sidebar Top", side: "right", status: "active", advertiser: "EroAds Media", campaignName: "Luxe Desire", start: "Dec 10", end: "Jan 09" },
  { id: 7, name: "Right Sidebar 2", side: "right", status: "available" },
  { id: 8, name: "Right Sidebar 3", side: "right", status: "active", advertiser: "NeonMedia", campaignName: "Neon City Push", start: "Dec 12", end: "Jan 11" },
  { id: 9, name: "Right Sidebar 4", side: "right", status: "available" },
  { id: 10, name: "Right Sidebar Bottom", side: "right", status: "available" },
];

/* -------------------------- advertisements -------------------------- */

export const INITIAL_ADS: AdCreative[] = [
  { id: "ad1", name: "EroX Promo — Hero Creative", advertiser: "EroAds Media", url: "https://erox.example.com/lp", slotId: 1, slotName: "Left Sidebar Top", period: "Dec 01 – Dec 30", status: "active", thumb: px(24407296) },
  { id: "ad2", name: "SeduceX — December Push", advertiser: "EroAds Media", url: "https://seducex.example.com", slotId: 5, slotName: "Left Sidebar Bottom", period: "Dec 03 – Jan 02", status: "active", thumb: px(7277907) },
  { id: "ad3", name: "Velvet Nights Banner", advertiser: "VelvetAds Co.", url: "https://velvet.example.com/nights", slotId: 3, slotName: "Left Sidebar 3", period: "Dec 05 – Jan 04", status: "active", thumb: px(38074638) },
  { id: "ad4", name: "Neon City Push", advertiser: "NeonMedia", url: "https://neoncity.example.com", slotId: 8, slotName: "Right Sidebar 3", period: "Dec 12 – Jan 11", status: "active", thumb: px(19186315) },
  { id: "ad5", name: "Afterglow — Winter Cut", advertiser: "Afterglow Ltd", url: "https://afterglow.example.com", slotId: 2, slotName: "Left Sidebar 2", period: "Dec 14 – Jan 13", status: "active", thumb: px(10442969) },
  { id: "ad6", name: "PlayX Weekender", advertiser: "PlayX Media", url: "https://playx.example.com/weekend", slotId: 7, slotName: "Right Sidebar 2", period: "Rejected Nov 09", status: "rejected", thumb: px(6537115) },
];

/* --------------------------- advertisers --------------------------- */

export const INITIAL_ADVERTISERS: Advertiser[] = [
  { id: "a1", name: "EroAds Media", contact: "Alex Morgan", email: "ads@eroads.media", registered: "Nov 12, 2026", campaigns: 3, status: "active" },
  { id: "a2", name: "VelvetAds Co.", contact: "Dana Reyes", email: "hello@velvetads.co", registered: "Nov 20, 2026", campaigns: 1, status: "active" },
  { id: "a3", name: "NeonMedia", contact: "Jonas Frey", email: "partners@neonmedia.io", registered: "Dec 08, 2026", campaigns: 1, status: "active" },
  { id: "a4", name: "PlayX Media", contact: "Mara Lind", email: "team@playx.media", registered: "Oct 28, 2026", campaigns: 0, status: "suspended" },
  { id: "a5", name: "Luxe Partners", contact: "Sofia Brandt", email: "sofia@luxepartners.eu", registered: "Nov 03, 2026", campaigns: 2, status: "active" },
  { id: "a6", name: "Afterglow Ltd", contact: "Theo March", email: "theo@afterglow.co", registered: "Dec 11, 2026", campaigns: 1, status: "active" },
];

/* ---------------------------- campaigns ---------------------------- */

export const INITIAL_CAMPAIGNS: AdminCampaign[] = [
  { id: "c1", name: "EroX Promo", advertiser: "EroAds Media", placement: "Slot 1 · Left Sidebar Top", start: "Dec 01, 2026", end: "Dec 30, 2026", status: "active", price: 99, impressions: "412.2K", clicks: "6.4K" },
  { id: "c2", name: "Velvet Nights", advertiser: "VelvetAds Co.", placement: "Slot 3 · Left Sidebar 3", start: "Dec 05, 2026", end: "Jan 04, 2027", status: "active", price: 99, impressions: "348.9K", clicks: "5.1K" },
  { id: "c3", name: "SeduceX", advertiser: "EroAds Media", placement: "Slot 5 · Left Sidebar Bottom", start: "Dec 03, 2026", end: "Jan 02, 2027", status: "active", price: 99, impressions: "188.6K", clicks: "2.9K" },
  { id: "c4", name: "Luxe Desire", advertiser: "EroAds Media", placement: "Slot 6 · Right Sidebar Top", start: "Dec 10, 2026", end: "Jan 09, 2027", status: "active", price: 99, impressions: "211.6K", clicks: "3.3K" },
  { id: "c5", name: "Neon City Push", advertiser: "NeonMedia", placement: "Slot 8 · Right Sidebar 3", start: "Dec 12, 2026", end: "Jan 11, 2027", status: "active", price: 99, impressions: "41.2K", clicks: "612" },
  { id: "c6", name: "Gold & Silk", advertiser: "Luxe Partners", placement: "Slot 4 · Left Sidebar 4", start: "Nov 10, 2026", end: "Dec 10, 2026", status: "completed", price: 99, impressions: "296.3K", clicks: "4.2K" },
  { id: "c7", name: "Afterglow Classic", advertiser: "Afterglow Ltd", placement: "Slot 9 · Right Sidebar 4", start: "Nov 01, 2026", end: "Nov 30, 2026", status: "completed", price: 99, impressions: "238.7K", clicks: "3.5K" },
  { id: "c8", name: "Weekender", advertiser: "Luxe Partners", placement: "Slot 2 · Left Sidebar 2", start: "Oct 15, 2026", end: "Nov 15, 2026", status: "paused", price: 99, impressions: "198.4K", clicks: "2.8K" },
];

/* ----------------------------- payments ---------------------------- */

export const INITIAL_PAYMENTS: Payment[] = [
  { id: "PAY-9041", advertiser: "NeonMedia", desc: "Slot 8 reservation — 1 month", amount: 99, method: "Wallet", date: "Dec 12, 2026", status: "paid" },
  { id: "PAY-9040", advertiser: "EroAds Media", desc: "Slot 6 reservation — 1 month", amount: 99, method: "Wallet", date: "Dec 10, 2026", status: "paid" },
  { id: "PAY-9039", advertiser: "EroAds Media", desc: "Wallet top-up", amount: 942.8, method: "Visa •••• 4242", date: "Dec 08, 2026", status: "paid" },
  { id: "PAY-9038", advertiser: "VelvetAds Co.", desc: "Slot 3 reservation — 1 month", amount: 99, method: "Visa •••• 3311", date: "Dec 05, 2026", status: "paid" },
  { id: "PAY-9037", advertiser: "Afterglow Ltd", desc: "Slot 2 reservation — 1 month", amount: 99, method: "Wallet", date: "Dec 05, 2026", status: "pending" },
  { id: "PAY-9036", advertiser: "EroAds Media", desc: "Slot 1 reservation — 1 month", amount: 99, method: "Wallet", date: "Dec 01, 2026", status: "paid" },
  { id: "PAY-9035", advertiser: "PlayX Media", desc: "Slot 7 reservation — 1 month", amount: 99, method: "Visa •••• 8814", date: "Nov 09, 2026", status: "failed" },
  { id: "PAY-9034", advertiser: "Luxe Partners", desc: "Slot 4 reservation — 1 month", amount: 99, method: "SEPA transfer", date: "Nov 10, 2026", status: "paid" },
];

/* ----------------------------- reports ----------------------------- */

export const INITIAL_REPORTS: Report[] = [
  { id: "r1", type: "Video", reason: "Copyright Violation", content: "Late Night Temptation", reportedBy: "velvet.ip", date: "Dec 13, 2026", status: "new" },
  { id: "r2", type: "Video", reason: "Content Policy Concern", content: "Weekend Vibes", reportedBy: "mod.watch", date: "Dec 12, 2026", status: "in-review", note: "Checking age-verification paperwork with the uploader." },
  { id: "r3", type: "Advertisement", reason: "Misleading Ad", content: "SeduceX — December Push", reportedBy: "ad.guardian", date: "Dec 11, 2026", status: "new" },
  { id: "r4", type: "Advertiser", reason: "Suspicious Billing", content: "NeonMedia", reportedBy: "risk.bot", date: "Dec 10, 2026", status: "in-review" },
  { id: "r5", type: "Video", reason: "Mistagged Category", content: "Private Session", reportedBy: "curator.22", date: "Dec 09, 2026", status: "resolved", note: "Retagged to POV on Dec 10." },
  { id: "r6", type: "Advertisement", reason: "Broken Destination URL", content: "Afterglow — Winter Cut", reportedBy: "uptime.owl", date: "Dec 08, 2026", status: "resolved", note: "Advertiser updated the landing page." },
];

/* ------------------------------ users ------------------------------ */

export const INITIAL_USERS: UserAccount[] = [
  { id: "u1", name: "Admin User", email: "admin@erobabe.com", role: "Administrator", status: "active", joined: "Oct 01, 2026" },
  { id: "u2", name: "Lena Hoff", email: "lena@erobabe.com", role: "Moderator", status: "active", joined: "Oct 04, 2026" },
  { id: "u3", name: "Chris Novak", email: "chris@erobabe.com", role: "Moderator", status: "active", joined: "Oct 19, 2026" },
  { id: "u4", name: "Alex Morgan", email: "ads@eroads.media", role: "Advertiser", status: "active", joined: "Nov 12, 2026" },
  { id: "u5", name: "Dana Reyes", email: "hello@velvetads.co", role: "Advertiser", status: "active", joined: "Nov 20, 2026" },
  { id: "u6", name: "Jonas Frey", email: "partners@neonmedia.io", role: "Advertiser", status: "active", joined: "Dec 08, 2026" },
  { id: "u7", name: "Mara Lind", email: "team@playx.media", role: "Advertiser", status: "disabled", joined: "Oct 28, 2026" },
  { id: "u8", name: "Guest Reviewer", email: "review@guest.io", role: "Member", status: "active", joined: "Dec 02, 2026" },
];

/* ------------------------------- logs ------------------------------ */

export const INITIAL_LOGS: LogEntry[] = [
  { id: "l1", time: "Dec 14, 2026 · 09:31", actor: "Admin User", action: "Published video", target: "Late Night Temptation", level: "info" },
  { id: "l2", time: "Dec 14, 2026 · 08:55", actor: "Lena Hoff", action: "Approved advertiser", target: "Afterglow Ltd", level: "info" },
  { id: "l3", time: "Dec 13, 2026 · 22:02", actor: "System", action: "Transcode completed", target: "Neon Nights (4K)", level: "info" },
  { id: "l4", time: "Dec 13, 2026 · 19:47", actor: "Chris Novak", action: "Rejected creative", target: "PlayX Weekender", level: "warning" },
  { id: "l5", time: "Dec 13, 2026 · 16:12", actor: "System", action: "Payment retry failed", target: "PAY-9035 · PlayX Media", level: "error" },
  { id: "l6", time: "Dec 13, 2026 · 11:29", actor: "Admin User", action: "Updated slot price", target: "All rails — $99/mo", level: "info" },
  { id: "l7", time: "Dec 12, 2026 · 20:14", actor: "Lena Hoff", action: "Resolved report", target: "Misleading Ad · SeduceX", level: "info" },
  { id: "l8", time: "Dec 12, 2026 · 09:03", actor: "System", action: "Daily digest emailed", target: "3 administrators", level: "info" },
  { id: "l9", time: "Dec 11, 2026 · 17:40", actor: "Admin User", action: "Suspended account", target: "PlayX Media", level: "warning" },
  { id: "l10", time: "Dec 11, 2026 · 10:18", actor: "System", action: "Backup snapshot created", target: "media-index (demo)", level: "info" },
];

/* --------------------------- categories ---------------------------- */

/** Mirrors the public site taxonomy (src/data/content.ts). */
export const INITIAL_CATEGORIES: CategoryRec[] = [
  { id: "cat1", label: "Mature", icon: "flame", videos: 248 },
  { id: "cat2", label: "Amateur", icon: "camera", videos: 176 },
  { id: "cat3", label: "POV", icon: "eye", videos: 112 },
  { id: "cat4", label: "Lesbian", icon: "users", videos: 96 },
  { id: "cat5", label: "Kinky", icon: "mask", videos: 88 },
  { id: "cat6", label: "Mature 18+", icon: "wine", videos: 134 },
  { id: "cat7", label: "Couples", icon: "heart", videos: 121 },
  { id: "cat8", label: "Boudoir", icon: "sparkles", videos: 92 },
  { id: "cat9", label: "Romantic", icon: "heart", videos: 118 },
  { id: "cat10", label: "Solo", icon: "user", videos: 87 },
  { id: "cat11", label: "Roleplay", icon: "drama", videos: 73 },
  { id: "cat12", label: "Massage", icon: "flower", videos: 64 },
];

/* ---------------------------- playlists ---------------------------- */

export const INITIAL_PLAYLISTS: Playlist[] = [
  { id: "p1", name: "After Hours", desc: "Late-night editorial picks", videoIds: ["v01", "v04", "v07", "v11"], updated: "Dec 13, 2026" },
  { id: "p2", name: "Slow Burn", desc: "Unhurried, cinematic sessions", videoIds: ["v02", "v08", "v12"], updated: "Dec 11, 2026" },
  { id: "p3", name: "Weekend Edition", desc: "Fresh uploads for the weekend rail", videoIds: ["v05", "v09", "v10"], updated: "Dec 09, 2026" },
];

/* ------------------------- pending queues -------------------------- */

export const PENDING_VIDEOS: PendingVideo[] = [
  { id: "pv1", title: "Noir Confessions", category: "POV", thumb: px(17553416), submitted: "Dec 14, 2026 · 07:52", uploader: "studio.noir" },
  { id: "pv2", title: "Silk Repertoire", category: "Mature 18+", thumb: px(9140302), submitted: "Dec 13, 2026 · 23:18", uploader: "silk.work" },
  { id: "pv3", title: "After Hours Cut", category: "Popular", thumb: px(19186315), submitted: "Dec 13, 2026 · 20:44", uploader: "afterhours.tv" },
];

export const PENDING_ADS: PendingAd[] = [
  { id: "pa1", advertiser: "NeonMedia", slotId: 8, slotName: "Right Sidebar 3", url: "https://neoncity.example.com", duration: "1 month", thumb: px(19186315) },
  { id: "pa2", advertiser: "Afterglow Ltd", slotId: 2, slotName: "Left Sidebar 2", url: "https://afterglow.example.com", duration: "1 month", thumb: px(10442969) },
  { id: "pa3", advertiser: "Luxe Partners", slotId: 9, slotName: "Right Sidebar 4", url: "https://luxepartners.example.com", duration: "2 months", thumb: px(736415) },
];

export const PENDING_ADVERTISERS: PendingAdvertiser[] = [
  { id: "a3", name: "NeonMedia", contact: "Jonas Frey", email: "partners@neonmedia.io", registered: "Dec 08, 2026" },
  { id: "a6", name: "Afterglow Ltd", contact: "Theo March", email: "theo@afterglow.co", registered: "Dec 11, 2026" },
  { id: "a7", name: "Scarlet Digital", contact: "Ines Vidal", email: "ines@scarlet.digital", registered: "Dec 13, 2026" },
];

/* ----------------------------- revenue ------------------------------ */

const decDays = Array.from({ length: 12 }, (_, i) => (i % 3 === 0 || i === 11 ? `Dec ${i + 1}` : ""));
const novDays = Array.from({ length: 12 }, (_, i) => (i % 3 === 0 || i === 11 ? `Nov ${i + 1}` : ""));
const weeks = Array.from({ length: 12 }, (_, i) => (i % 3 === 0 || i === 11 ? `W${i + 1}` : ""));

export const REVENUE: Record<string, { data: number[]; labels: string[]; total: string; ad: string; other: string }> = {
  month: { data: [512, 640, 588, 720, 805, 764, 890, 940, 862, 990, 1042, 1089], labels: decDays, total: "$9,842.50", ad: "$9,240.00", other: "$602.50" },
  last: { data: [470, 520, 610, 585, 660, 702, 688, 745, 810, 780, 845, 905], labels: novDays, total: "$8,960.00", ad: "$8,415.00", other: "$545.00" },
  qtr: { data: [1620, 1780, 1690, 1920, 2150, 2080, 2340, 2510, 2420, 2690, 2840, 3010], labels: weeks, total: "$27,410.00", ad: "$25,830.00", other: "$1,580.00" },
};

export const VIEWS_SPARK = [18, 22, 20, 26, 31, 28, 34, 39, 35, 42, 46, 44];
export const REVENUE_SPARK = [9, 12, 11, 14, 16, 15, 18, 20, 19, 22, 24, 26];

/* ---------------------------- notices ------------------------------ */

export const ADMIN_NOTICES: Notice[] = [
  { id: "n1", title: "8 videos awaiting review", body: "The publishing queue needs attention.", time: "18m ago", unread: true },
  { id: "n2", title: "New advertiser application", body: "Scarlet Digital registered 2 hours ago.", time: "2h ago", unread: true },
  { id: "n3", title: "Payout batch processed", body: "$2,940.00 settled to 4 advertisers.", time: "6h ago", unread: true },
  { id: "n4", title: "System check passed", body: "All demo health indicators are green.", time: "1d ago", unread: false },
];

/* ----------------------------- settings ---------------------------- */

export interface SiteSettings {
  siteTitle: string;
  tagline: string;
  slotPrice: number;
  autoApprove: boolean;
  showViewCounts: boolean;
  enableComments: boolean;
  maintenanceMode: boolean;
  matureWarning: boolean;
}

export const INITIAL_SETTINGS: SiteSettings = {
  siteTitle: "erobabe",
  tagline: "Your destination for discovering premium adult entertainment.",
  slotPrice: 99,
  autoApprove: false,
  showViewCounts: true,
  enableComments: false,
  maintenanceMode: false,
  matureWarning: true,
};
