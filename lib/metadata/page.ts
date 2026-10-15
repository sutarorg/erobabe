import type { Metadata } from "next";

/** Keep page metadata and share previews aligned rather than inheriting home copy. */
export function publicPageMetadata(input: Metadata): Metadata {
  const title = typeof input.title === "string" ? input.title : undefined;
  const description = input.description || undefined;
  return {
    ...input,
    openGraph: input.openGraph || {
      type: "website",
      siteName: "erobabe",
      title,
      description,
      url: typeof input.alternates?.canonical === "string" ? input.alternates.canonical : undefined,
    },
    twitter: { card: "summary", title, description, ...input.twitter },
  };
}
