import { LOGO_URL, SITE_URL } from "@/lib/site";

export type BreadcrumbItem = {
  name: string;
  path: string;
};

export function websiteJsonLd(siteUrl = SITE_URL) {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "erobabe",
    url: siteUrl,
    inLanguage: "en",
    description:
      "Adult video catalog for viewers 18 and older. Browse categories, latest uploads, and popular scenes.",
    publisher: {
      "@type": "Organization",
      name: "erobabe",
      url: siteUrl,
      logo: {
        "@type": "ImageObject",
        url: LOGO_URL,
      },
    },
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
