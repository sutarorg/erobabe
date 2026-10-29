"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  adForPosition,
  orderedAds,
  rotationSeed,
  type RotatableAd,
} from "@/lib/ads/rotation";

const VISITOR_KEY = "erobabe:ad-visitor";

type MobileAdsValue = {
  /** The visitor-specific rotation order of every active creative. */
  ads: RotatableAd[];
  /** The creative for a banner position; null only when no ad is active. */
  adAt: (position: number) => RotatableAd | null;
};

const MobileAdsContext = createContext<MobileAdsValue>({
  ads: [],
  adAt: () => null,
});

/** Stable per-browser token; generated once and reused across visits. */
function readVisitorToken(): string {
  try {
    const existing = window.localStorage.getItem(VISITOR_KEY);
    if (existing && existing.length >= 8) return existing;
    const created =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `visitor-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    window.localStorage.setItem(VISITOR_KEY, created);
    return created;
  } catch {
    return "";
  }
}

/**
 * Supplies the rotating creative pool to every mobile banner.
 *
 * The server renders a deterministic order so hydration matches, then the
 * visitor's own token (plus the current UTC day) reshuffles it — so two people
 * on the same page do not see the same advertiser in the same banner, and one
 * visitor's order stays stable while they browse.
 */
export default function MobileAdsProvider({
  ads,
  children,
}: {
  ads: RotatableAd[];
  children: ReactNode;
}) {
  const poolKey = useMemo(
    () => ads.map((ad) => `${ad.id}:${ad.image_url}`).join("|"),
    [ads],
  );
  // Deterministic first paint; replaced by the seeded order after hydration.
  const [seed, setSeed] = useState("erobabe-visitor");

  useEffect(() => {
    setSeed(rotationSeed(readVisitorToken()));
  }, []);

  const ordered = useMemo(() => orderedAds(ads, seed), [poolKey, seed]); // eslint-disable-line react-hooks/exhaustive-deps

  const value = useMemo<MobileAdsValue>(
    () => ({
      ads: ordered,
      adAt: (position: number) => adForPosition(ordered, position),
    }),
    [ordered],
  );

  return <MobileAdsContext.Provider value={value}>{children}</MobileAdsContext.Provider>;
}

export function useMobileAds() {
  return useContext(MobileAdsContext);
}
