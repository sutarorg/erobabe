import type { Metadata } from "next";
import { SITE_NAME, SITE_OG_IMAGE, SITE_URL } from "@/lib/site";
import { STATIC_PAGE_SEO, type StaticPageKey } from "@/lib/seo/pages";

/**
 * Page titles are stored finished (brand suffix included), so they are emitted
 * as `absolute` to keep the `%s | EroBabe` template from doubling the name.
 * Dynamically generated titles keep the bare string form and inherit it.
 */
export function resolvedTitle(title: Metadata["title"]): string | undefined {
  if (typeof title === "string") return title;
  if (title && typeof title === "object" && "absolute" in title) {
    return title.absolute || undefined;
  }
  return undefined;
}

/**
 * Keep page metadata and share previews aligned rather than inheriting home
 * copy: every public page gets its own title, description, keywords and a
 * same-origin share image unless it passes a better one.
 */
export function publicPageMetadata(input: Metadata): Metadata {
  const title = resolvedTitle(input.title);
  const description =
    typeof input.description === "string" ? input.description : undefined;
  const keywords = Array.isArray(input.keywords)
    ? input.keywords
    : typeof input.keywords === "string"
      ? input.keywords
      : undefined;
  const canonical =
    typeof input.alternates?.canonical === "string" ? input.alternates.canonical : undefined;
  return {
    ...input,
    keywords,
    robots: input.robots ?? {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        "max-image-preview": "large",
        "max-snippet": -1,
        "max-video-preview": -1,
      },
    },
    // Pages may supply their own Open Graph block (a watch page shows its own
    // thumbnail, for example) but the site name and a share image always survive.
    openGraph: input.openGraph
      ? {
          siteName: SITE_NAME,
          ...(input.openGraph as Record<string, unknown>),
          images: input.openGraph.images ?? [SITE_OG_IMAGE],
        }
      : {
          type: "website",
          siteName: SITE_NAME,
          title,
          description,
          url: canonical,
          images: [SITE_OG_IMAGE],
        },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [SITE_OG_IMAGE],
      ...input.twitter,
    },
  };
}

/**
 * Metadata for a page whose copy lives in `lib/seo/pages.ts`. Titles are
 * emitted absolute so the layout template cannot append the brand twice.
 */
export function staticPageMetadata(key: StaticPageKey, path = ""): Metadata {
  const copy = STATIC_PAGE_SEO[key];
  return publicPageMetadata({
    title: { absolute: copy.title },
    description: copy.description,
    keywords: copy.keywords,
    alternates: { canonical: path ? `${SITE_URL}${path}` : SITE_URL },
  });
}
