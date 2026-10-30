/**
 * The one place where page titles, descriptions and keywords live.
 *
 * Every title here is the *final* string that lands in `<title>` and the share
 * cards, brand suffix included, so a page can never drift into
 * "Latest Porn Videos | EroBabe | EroBabe". Pages that do not appear in this
 * table keep the `%s | EroBabe` template from the root layout.
 */

export type SeoCopy = {
  /** Final `<title>` text, brand suffix included. */
  title: string;
  description: string;
  /** Kept for the search engines that still read it (Bing, Yandex, Baidu). */
  keywords: string[];
};

export const SITE_NAME = "EroBabe";

/** Title used when a page has no copy of its own. */
export const DEFAULT_SEO: SeoCopy = {
  title: "Free HD Porn Videos & XXX Movies | EroBabe",
  description:
    "Explore Erobabe's growing collection of high-quality XXX movies and clips. Watch new free porn videos and trending adult content, updated regularly. 18+ only.",
  keywords: [
    "free porn",
    "HD porn videos",
    "XXX movies",
    "free porn videos",
    "adult videos",
    "trending porn",
    "watch porn online",
    "erobabe",
    "pussy",
    "sex",
  ],
};

/**
 * Static pages, keyed by route. `/` deliberately keeps its brand-free title -
 * the site name is carried by `WebSite` structured data and `og:site_name`,
 * not by stuffing the domain into the title.
 */
export const STATIC_PAGE_SEO = {
  // Straight from the brief: the home title carries no brand suffix.
  home: { ...DEFAULT_SEO, title: "Free HD Porn Videos & XXX Movies" },
  categories: {
    title: "Browse All Porn Categories | EroBabe",
    description:
      "Explore every porn category on EroBabe - amateur, MILF, lesbian, hentai, POV, ebony and more. Filter by your favorite kinks and start watching free.",
    keywords: [
      "porn categories",
      "all porn categories",
      "browse porn",
      "amateur porn",
      "MILF porn",
      "lesbian porn",
      "hentai",
      "POV porn",
      "ebony porn",
      "free porn categories",
    ],
  },
  latest: {
    title: "Latest Porn Videos | EroBabe",
    description:
      "The newest porn videos, added hourly. Watch fresh amateur, MILF, hentai and hardcore scenes the moment they drop on EroBabe.",
    keywords: [
      "latest porn videos",
      "new porn",
      "fresh porn videos",
      "porn added hourly",
      "new amateur porn",
      "new hardcore porn",
      "watch new porn",
    ],
  },
  popular: {
    title: "Most Popular Porn Videos | EroBabe",
    description:
      "See what everyone's watching. The top trending and most-viewed porn videos on EroBabe, ranked by real viewer popularity.",
    keywords: [
      "popular porn videos",
      "trending porn",
      "most viewed porn",
      "top porn videos",
      "best porn videos",
      "hot porn rankings",
      "most popular porn",
    ],
  },
  about: {
    title: "About EroBabe",
    description:
      "Learn what EroBabe is about: a fast, ad-light hub for free HD porn across every category, built for smooth browsing on any device.",
    keywords: [
      "about EroBabe",
      "EroBabe site",
      "free HD porn site",
      "ad-light porn",
      "porn on mobile",
      "EroBabe info",
      "fast porn site",
    ],
  },
  terms: {
    title: "Terms of Service | EroBabe",
    description:
      "Read the terms and conditions governing your use of EroBabe, including access rules, content usage and user obligations.",
    keywords: [
      "EroBabe terms of service",
      "terms and conditions",
      "adult site terms",
      "content usage rules",
      "user obligations",
      "site access rules",
      "terms of use",
    ],
  },
  privacy: {
    title: "Privacy Policy | EroBabe",
    description:
      "How EroBabe handles your data: what we collect, cookies, third-party services and your privacy rights explained plainly.",
    keywords: [
      "EroBabe privacy policy",
      "privacy",
      "cookies policy",
      "data collection",
      "third-party services",
      "privacy rights",
      "adult site privacy",
    ],
  },
  dmca: {
    title: "DMCA & Copyright Policy | EroBabe",
    description:
      "EroBabe's DMCA policy - how copyright holders can submit takedown notices and how we handle infringement claims.",
    keywords: [
      "EroBabe DMCA",
      "DMCA policy",
      "copyright takedown",
      "takedown notice",
      "copyright infringement",
      "DMCA notice",
      "copyright holders",
    ],
  },
  compliance2257: {
    title: "18 U.S.C. 2257 | EroBabe",
    description:
      "Our 2257 statement: record-keeping compliance details and where required performer documentation is held for hosted content.",
    keywords: [
      "18 USC 2257",
      "2257 statement",
      "record keeping compliance",
      "performer documentation",
      "adult compliance",
      "2257 records",
      "EroBabe 2257",
    ],
  },
  parentalControls: {
    title: "Parental Controls | EroBabe",
    description:
      "How to block EroBabe and other adult sites - practical setup guides for browsers, routers, DNS filters and kid-safe devices.",
    keywords: [
      "parental controls",
      "block porn",
      "block adult sites",
      "DNS filter",
      "router parental controls",
      "kid-safe browsing",
      "block EroBabe",
    ],
  },
  contact: {
    title: "Contact EroBabe",
    description:
      "Get in touch with the EroBabe team for support, content issues, partnerships or general questions. We respond fast.",
    keywords: [
      "contact EroBabe",
      "EroBabe support",
      "content issues",
      "partnerships",
      "adult site contact",
      "EroBabe help",
      "get in touch",
    ],
  },
  faq: {
    title: "EroBabe FAQ",
    description:
      "Answers to the most common questions about EroBabe: free access, video quality, categories, downloads and troubleshooting.",
    keywords: [
      "EroBabe FAQ",
      "porn site FAQ",
      "free porn access",
      "video quality",
      "download porn",
      "troubleshooting",
      "EroBabe questions",
    ],
  },
  contentRemoval: {
    title: "Content Removal Request | EroBabe",
    description:
      "Need a video taken down? Submit a content removal request to EroBabe and learn what info we need to process it quickly.",
    keywords: [
      "content removal",
      "content removal request",
      "remove porn video",
      "takedown request",
      "remove video from EroBabe",
      "copyright removal",
      "EroBabe takedown",
    ],
  },
} satisfies Record<string, SeoCopy>;

export type StaticPageKey = keyof typeof STATIC_PAGE_SEO;

/**
 * Category landing pages. A watch page reuses its category's description and
 * keywords, so every video inherits copy that already matches what people
 * search for.
 */
export const CATEGORY_SEO: Record<string, SeoCopy> = {
  amateur: {
    title: "Free Amateur Porn Videos | EroBabe",
    description:
      "Homemade amateur porn with real couples and everyday girls. Raw, unfiltered clips in HD, updated daily on EroBabe.",
    keywords: [
      "amateur porn",
      "free amateur porn",
      "homemade porn",
      "real couple porn",
      "amateur porn videos",
      "amateur sex videos",
      "real amateur girls",
    ],
  },
  lesbian: {
    title: "Free Lesbian Porn Videos | EroBabe",
    description:
      "Hot lesbian porn: girl-on-girl scenes from soft to hardcore, starring real chemistry and gorgeous women. Watch free in HD.",
    keywords: [
      "lesbian porn",
      "free lesbian porn",
      "girl on girl porn",
      "lesbian sex videos",
      "hot lesbian porn",
      "lesbian HD videos",
      "lesbian scenes",
    ],
  },
  milf: {
    title: "Free MILF Porn Videos | EroBabe",
    description:
      "Busty MILFs and experienced older women in steamy HD scenes. The best mature porn, freshly added every day on EroBabe.",
    keywords: [
      "MILF porn",
      "free MILF porn",
      "mature porn",
      "busty MILF",
      "older women porn",
      "MILF sex videos",
      "hot MILF HD",
    ],
  },
  japanese: {
    title: "Free Japanese Porn Videos | EroBabe",
    description:
      "Japanese porn and JAV clips - uncensored where available, from amateur to pro stars. Stream free in HD on EroBabe.",
    keywords: [
      "Japanese porn",
      "JAV",
      "JAV porn",
      "Japanese sex videos",
      "uncensored Japanese porn",
      "Japanese amateur porn",
      "Asian porn",
    ],
  },
  "teen-18plus": {
    title: "Free Teen (18+) Porn Videos | EroBabe",
    description:
      "Barely-legal 18+ teen porn featuring fresh faces and petite newcomers in HD. Updated daily - all free on EroBabe.",
    keywords: [
      "teen porn",
      "18+ teen porn",
      "barely legal porn",
      "petite porn",
      "young porn videos",
      "fresh faces porn",
      "teen HD porn",
    ],
  },
  hentai: {
    title: "Free Hentai Porn Videos | EroBabe",
    description:
      "Hentai and anime porn in HD - 2D fantasies, uncensored scenes and full episodes. Stream free on EroBabe, no signup.",
    keywords: [
      "hentai",
      "hentai porn",
      "anime porn",
      "uncensored hentai",
      "hentai videos",
      "2D porn",
      "hentai episodes",
    ],
  },
  ebony: {
    title: "Free Ebony Porn Videos | EroBabe",
    description:
      "Gorgeous Black women in hot ebony porn, from amateur to pro. Big curves, real chemistry, HD quality - free on EroBabe.",
    keywords: [
      "ebony porn",
      "Black women porn",
      "free ebony porn",
      "ebony sex videos",
      "big curves porn",
      "amateur ebony porn",
      "black girl porn",
    ],
  },
  pov: {
    title: "Free POV Porn Videos | EroBabe",
    description:
      "Point-of-view porn that puts you in the scene. Immersive first-person clips in HD, updated daily and free on EroBabe.",
    keywords: [
      "POV porn",
      "point of view porn",
      "first person porn",
      "immersive porn",
      "POV sex videos",
      "free POV porn",
      "POV HD",
    ],
  },
  "big-ass": {
    title: "Free Big Ass Porn Videos | EroBabe",
    description:
      "Big booty porn starring thick, curvy women. Bubble butts and pawg scenes in HD - stream free, no signup on EroBabe.",
    keywords: [
      "big ass porn",
      "big booty porn",
      "pawg",
      "thick women porn",
      "bubble butt porn",
      "curvy women porn",
      "free big ass porn",
    ],
  },
  threesome: {
    title: "Free Threesome Porn Videos | EroBabe",
    description:
      "Hot threesome porn: MMF, FFM and more multi-partner action in HD. Watch free threesome scenes daily on EroBabe.",
    keywords: [
      "threesome porn",
      "FFM porn",
      "MMF porn",
      "multi-partner porn",
      "threesome sex videos",
      "free threesome porn",
      "group sex",
    ],
  },
  hardcore: {
    title: "Free Hardcore Porn Videos | EroBabe",
    description:
      "Intense hardcore porn with rough, explicit action. No-holds-barred HD scenes, freshly added daily and free on EroBabe.",
    keywords: [
      "hardcore porn",
      "rough porn",
      "explicit porn",
      "hardcore sex videos",
      "no-holds-barred porn",
      "intense porn",
      "free hardcore porn",
    ],
  },
  massage: {
    title: "Free Massage Porn Videos | EroBabe",
    description:
      "Sensual massage porn: oily hands, happy endings and full-service rubdowns in HD. Stream free on EroBabe.",
    keywords: [
      "massage porn",
      "sensual massage porn",
      "oily massage",
      "happy ending porn",
      "rubdown porn",
      "massage sex videos",
      "free massage porn",
    ],
  },
};

/**
 * Category copy for a slug we know, and honest, non-duplicated fallback copy
 * for a category an admin adds later.
 */
export function categorySeo(slug: string, label: string): SeoCopy {
  const known = CATEGORY_SEO[slug];
  if (known) return known;
  return {
    title: `${label} Porn Videos | EroBabe`,
    description: `Watch free ${label} porn videos in HD on EroBabe. Hand-picked ${label.toLowerCase()} scenes, updated regularly. 18+ only.`,
    keywords: [
      `${label} porn`,
      `free ${label} porn`,
      `${label.toLowerCase()} porn videos`,
      `${label.toLowerCase()} sex videos`,
      "EroBabe",
      "free porn",
    ],
  };
}

/**
 * A watch page borrows its category's description and keywords: the video's
 * own title is the only thing that has to be unique.
 */
export function videoSeo(video: {
  title: string;
  categorySlug?: string | null;
  categoryLabel?: string | null;
}): { title: string; description: string; keywords: string[] } {
  const slug = video.categorySlug || "";
  const label = video.categoryLabel || "";
  const category = slug || label ? categorySeo(slug, label || slug) : undefined;
  return {
    title: video.title,
    description:
      category?.description ||
      `Watch ${video.title} free in HD on EroBabe. Adult video, 18+ only.`,
    keywords: category?.keywords || [
      video.title,
      "free porn",
      "HD porn videos",
      "EroBabe",
      "18+",
    ],
  };
}
