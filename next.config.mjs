/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Resolve metadata/notFound before streaming so missing videos return HTTP 404.
  htmlLimitedBots: /.*/,
  allowedDevOrigins: ["*.e2b.app"],
  poweredByHeader: false,
  compress: true,
  // Ship only the icons a page imports instead of the whole lucide barrel, and
  // keep source maps out of the production payload.
  experimental: {
    staleTimes: {
      dynamic: 30,
      static: 180,
    },
    optimizePackageImports: ["lucide-react"],
  },
  productionBrowserSourceMaps: false,
  images: {
    // Next's own optimizer serves AVIF/WebP and caches the result for a month;
    // every remote poster benefits without touching a component.
    formats: ['image/avif', 'image/webp'],
    minimumCacheTTL: 2678400,
    remotePatterns: [
      { protocol: 'https', hostname: 'i.postimg.cc' },
      { protocol: 'https', hostname: 'images.pexels.com' },
      { protocol: 'https', hostname: '**.supabase.co' },
      // Embedded damplips catalog: posters and media come from its hosts.
      { protocol: 'https', hostname: 'damplips.com' },
      { protocol: 'https', hostname: '**.damplips.com' },
      { protocol: 'https', hostname: '**.resend.com' },
    ],
  },
  async headers() {
    // Static artwork never changes under a given URL (the checkout appends a
    // version query when it does), so it can be cached for a year instead of
    // the default revalidate-on-every-visit of /public files.
    const ARTWORK_CACHE = 'public, max-age=31536000, immutable';
    return [
      {
        source: '/checkout/advertise-panel.webp',
        headers: [{ key: 'Cache-Control', value: ARTWORK_CACHE }],
      },
      {
        source: '/checkout/advertise-panel-720.webp',
        headers: [{ key: 'Cache-Control', value: ARTWORK_CACHE }],
      },
      {
        source: '/checkout/advertise-panel.png',
        headers: [{ key: 'Cache-Control', value: ARTWORK_CACHE }],
      },
      ...['/admin/:path*', '/checkout/:path*', '/auth/:path*', '/api/:path*'].map(source => ({
        source, headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }],
      })),
      {
        source: '/(.*)',
        headers: [
          ...(process.env.NODE_ENV === 'production' ? [{ key: 'X-Frame-Options', value: 'SAMEORIGIN' }] : []),
          ...(process.env.NODE_ENV === 'production' ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000' }] : []),
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Rating', value: 'RTA-5042-1996-1400-1577-RTA' },
        ],
      },
    ];
  },
};

export default nextConfig;
