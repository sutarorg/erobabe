import { SITE_LOGO_URL, SITE_NAME, SITE_URL } from "@/lib/site";

export type BreadcrumbItem = {
  name: string;
  path: string;
};

/**
 * The site itself. This node is what Google reads to label results as
 * "EroBabe" instead of falling back to the bare domain, so `name` and `url`
 * are the two properties that must never drift.
 */
export function websiteJsonLd(siteUrl = SITE_URL) {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${siteUrl}/#website`,
    name: SITE_NAME,
    alternateName: ["erobabe", "Erobabe"],
    url: siteUrl,
    inLanguage: "en",
    description:
      "Adult video catalog for viewers 18 and older. Browse categories, latest uploads, and popular scenes.",
    publisher: { "@id": `${siteUrl}/#organization` },
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: `${siteUrl}/?q={search_term_string}`,
      },
      "query-input": "required name=search_term_string",
    },
  };
}

/**
 * The brand behind the site, with a logo we host ourselves. Search surfaces
 * that show a publisher logo pull it from here.
 */
export function organizationJsonLd(siteUrl = SITE_URL) {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": `${siteUrl}/#organization`,
    name: SITE_NAME,
    alternateName: ["erobabe", "Erobabe"],
    url: siteUrl,
    logo: {
      "@type": "ImageObject",
      url: SITE_LOGO_URL,
      width: 600,
      height: 600,
    },
  };
}

export function breadcrumbJsonLd(items: BreadcrumbItem[], siteUrl = SITE_URL) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: item.path === "/" ? siteUrl : `${siteUrl}${item.path}`,
    })),
  };
}

export function collectionPageJsonLd(input: {
  name: string;
  description: string;
  path: string;
  siteUrl?: string;
}) {
  const siteUrl = input.siteUrl || SITE_URL;
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: input.name,
    description: input.description,
    url: `${siteUrl}${input.path}`,
    isFamilyFriendly: false,
    inLanguage: "en",
  };
}
