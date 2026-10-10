/* ------------------------------------------------------------------ */
/* Erobabe Admin Portal — production types (no mock data)              */
/* Real data comes from Supabase. Only fixed inventory seeded.         */
/* ------------------------------------------------------------------ */

export type VideoStatus = "published" | "processing" | "draft" | "unpublished" | "pending_review" | "rejected";
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
  status: "active" | "available" | "reserved" | "maintenance";
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
  status: "active" | "rejected" | "pending" | "approved";
  thumb: string;
}

export interface Advertiser {
  id: string;
  name: string;
  contact: string;
  email: string;
  registered: string;
  campaigns: number;
  status: "active" | "suspended" | "pending";
}

export interface AdminCampaign {
  id: string;
  name: string;
  advertiser: string;
  placement: string;
  start: string;
  end: string;
  status: "active" | "paused" | "completed" | "pending_payment" | "pending_review";
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
  status: "paid" | "pending" | "failed" | "confirmed";
}

export interface Report {
  id: string;
  type: "Video" | "Advertisement" | "Advertiser" | "Copyright" | "Other";
  reason: string;
  content: string;
  reportedBy: string;
  date: string;
  status: "new" | "in-review" | "resolved" | "dismissed";
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

export interface Notice {
  id: string;
  title: string;
  body: string;
  time: string;
  unread: boolean;
}

export const FALLBACK_THUMB = "https://i.postimg.cc/ZnrQD6fN/erobabe-favicon-removebg-preview.png";
export const SLOT_PRICE = 99;
export const fmtUSD = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

// Production: empty states, no mock
export const INITIAL_VIDEOS: AdminVideo[] = [];
export const INITIAL_SLOTS: AdminSlot[] = [
  { id: 1, name: "Left Sidebar Top", side: "left", status: "available" },
  { id: 2, name: "Left Sidebar 2", side: "left", status: "available" },
  { id: 3, name: "Left Sidebar 3", side: "left", status: "available" },
  { id: 4, name: "Left Sidebar 4", side: "left", status: "available" },
  { id: 5, name: "Left Sidebar Bottom", side: "left", status: "available" },
  { id: 6, name: "Right Sidebar Top", side: "right", status: "available" },
  { id: 7, name: "Right Sidebar 2", side: "right", status: "available" },
  { id: 8, name: "Right Sidebar 3", side: "right", status: "available" },
  { id: 9, name: "Right Sidebar 4", side: "right", status: "available" },
  { id: 10, name: "Right Sidebar Bottom", side: "right", status: "available" },
];
export const INITIAL_ADS: AdCreative[] = [];
export const INITIAL_ADVERTISERS: Advertiser[] = [];
export const INITIAL_CAMPAIGNS: AdminCampaign[] = [];
export const INITIAL_PAYMENTS: Payment[] = [];
export const INITIAL_REPORTS: Report[] = [];
export const INITIAL_USERS: UserAccount[] = [];
export const INITIAL_LOGS: LogEntry[] = [];
export const INITIAL_CATEGORIES: CategoryRec[] = [
  { id: "cat1", label: "Mature", icon: "flame", videos: 0 },
  { id: "cat2", label: "Amateur", icon: "camera", videos: 0 },
  { id: "cat3", label: "POV", icon: "eye", videos: 0 },
  { id: "cat4", label: "Lesbian", icon: "users", videos: 0 },
  { id: "cat5", label: "Kinky", icon: "mask", videos: 0 },
  { id: "cat6", label: "Mature 18+", icon: "wine", videos: 0 },
  { id: "cat7", label: "Couples", icon: "heart", videos: 0 },
  { id: "cat8", label: "Boudoir", icon: "sparkles", videos: 0 },
  { id: "cat9", label: "Romantic", icon: "heart", videos: 0 },
  { id: "cat10", label: "Solo", icon: "user", videos: 0 },
  { id: "cat11", label: "Roleplay", icon: "drama", videos: 0 },
  { id: "cat12", label: "Massage", icon: "flower", videos: 0 },
];
export const INITIAL_PLAYLISTS: Playlist[] = [];
export const PENDING_VIDEOS: any[] = [];
export const PENDING_ADS: any[] = [];
export const PENDING_ADVERTISERS: any[] = [];
export const REVENUE: any = {
  month: { data: [], labels: [], total: "$0.00", ad: "$0.00", other: "$0.00" },
  last: { data: [], labels: [], total: "$0.00", ad: "$0.00", other: "$0.00" },
  qtr: { data: [], labels: [], total: "$0.00", ad: "$0.00", other: "$0.00" },
};
export const VIEWS_SPARK: number[] = [];
export const REVENUE_SPARK: number[] = [];
export const ADMIN_NOTICES: Notice[] = [];

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
