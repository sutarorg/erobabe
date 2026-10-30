import type { MetadataRoute } from "next";
import { SITE_NAME } from "@/lib/site";
import { DEFAULT_SEO } from "@/lib/seo/pages";

/**
 * Install metadata. The manifest name is another place the brand is spelled
 * out, so Android home-screen shortcuts and the browser's install prompt both
 * say "EroBabe".
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE_NAME,
    short_name: SITE_NAME,
    description: DEFAULT_SEO.description,
    start_url: "/",
    display: "standalone",
    background_color: "#0b0b0d",
    theme_color: "#0b0b0d",
    icons: [
      { src: "/icons/icon-48x48.png", sizes: "48x48", type: "image/png" },
      { src: "/icons/icon-96x96.png", sizes: "96x96", type: "image/png" },
      { src: "/icons/icon-144x144.png", sizes: "144x144", type: "image/png" },
      { src: "/icons/icon-192x192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512x512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
