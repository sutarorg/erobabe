import type { Metadata } from "next";

/** Keep page metadata and share previews aligned rather than inheriting home copy. */
export function publicPageMetadata(input: Metadata): Metadata {
  const title = typeof input.title === "string" ? input.title : undefined;
  const description = input.description || undefined;
  const canonical =
    typeof input.alternates?.canonical === "string" ? input.alternates.canonical : undefined;
  return {
    ...input,
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
    openGraph: input.openGraph || {
      type: "website",
      siteName: "erobabe",
      title,
      description,
      url: canonical,
    },
    twitter: { card: "summary_large_image", title, description, ...input.twitter },
  };
}
