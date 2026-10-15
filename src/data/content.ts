"use client";
import { FIXED_CATEGORIES } from "@/lib/public/fixed-categories";
import { resolveCategoryIcon } from "../components/categoryIcons";

import {
  Camera,
  Drama,
  Eye,
  Flame,
  Flower2,
  Heart,
  HeartHandshake,
  LayoutGrid,
  Sparkles,
  UserRound,
  Users,
  VenetianMask,
  Wine,
  type LucideIcon,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/* Brand                                                               */
/* ------------------------------------------------------------------ */

export const LOGO_URL =
  "https://i.postimg.cc/ZnrQD6fN/erobabe-favicon-removebg-preview.png";

/* ------------------------------------------------------------------ */
/* Types — production (no mock video data)                             */
/* ------------------------------------------------------------------ */

export interface Category {
  id: string;
  label: string;
  icon: LucideIcon;
  slug?: string;
}

export interface Video {
  id: string; // slug
  title: string;
  category: string;
  duration: string;
  quality: "4K" | "HD";
  views: string;
  viewsNum: number;
  added: string;
  daysAgo: number;
  rating: number;
  thumb: string;
  alt: string;
  description: string;
  featured?: boolean;
}

export interface HeroSlide {
  id: string;
  eyebrow: string;
  headline: string;
  sub: string;
  image: string;
  alt: string;
  /** Set for admin-chosen video slides: the watch page the slide links to. */
  href?: string;
}

/* ------------------------------------------------------------------ */
/* Categories — real taxonomy (12 fixed, matches DB seed)              */
/* ------------------------------------------------------------------ */

export const CATEGORIES: Category[] = [
  ...FIXED_CATEGORIES.slice(0, 7).map(c => ({ id: c.slug, label: c.label, icon: resolveCategoryIcon(c.icon) })),
  { id: "more", label: "More", icon: LayoutGrid },
];
export const EXTRA_CATEGORIES: Category[] = FIXED_CATEGORIES.slice(7).map(c => ({ id: c.slug, label: c.label, icon: resolveCategoryIcon(c.icon) }));

export const ALL_CATEGORIES: Category[] = [
  ...CATEGORIES.filter((c) => c.id !== "more"),
  ...EXTRA_CATEGORIES,
];

export const categorySlug = (label: string): string =>
  label
    .toLowerCase()
    .replace(/\+/g, "plus")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

export const categoryFromSlug = (slug: string): string | null =>
  ALL_CATEGORIES.find((c) => categorySlug(c.label) === slug)?.label ?? null;

/* ------------------------------------------------------------------ */
/* Hero — uses owned/licensed promotional artwork, not Pexels stock    */
/* In production, replace images with properly licensed assets owned   */
/* by erobabe.                                                         */
/* ------------------------------------------------------------------ */

export const HERO_SLIDES: HeroSlide[] = [
  {
    id: "desire",
    eyebrow: "Hot & Exclusive",
    headline: "Seductive stories.\nEndless desire.",
    sub: "Explore premium videos and exclusive moments curated for adults.",
    image: LOGO_URL,
    alt: "Erobabe hero promotional artwork",
  },
  {
    id: "afterhours",
    eyebrow: "New This Week",
    headline: "After hours.\nJust the two of us.",
    sub: "Intimate cinematic encounters, owned and licensed by erobabe.",
    image: LOGO_URL,
    alt: "Erobabe after hours promotional artwork",
  },
  {
    id: "velvet",
    eyebrow: "Editor's Pick",
    headline: "Velvet nights.\nZero compromise.",
    sub: "Hand-picked premium scenes, verified and cleared for distribution.",
    image: LOGO_URL,
    alt: "Erobabe velvet nights promotional artwork",
  },
];

/* ------------------------------------------------------------------ */
/* Videos — REMOVED mock data                                          */
/* Production: videos come from Supabase DB, not hardcoded array.      */
/* When DB empty, render honest empty states:                          */
/* - No videos published yet                                            */
/* ------------------------------------------------------------------ */

export const VIDEOS: Video[] = [];
export const FEATURED_IDS: string[] = [];
export const FEATURED_VIDEOS: Video[] = [];
export const LATEST_VIDEOS: Video[] = [];
