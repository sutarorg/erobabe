/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Resolve metadata/notFound before streaming so missing videos return HTTP 404.
  htmlLimitedBots: /.*/,
  allowedDevOrigins: ["*.e2b.app"],
  poweredByHeader: false,
  compress: true,
  experimental: {
    staleTimes: {
      dynamic: 30,
      static: 180,
    },
  },
  images: {
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
    return [
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
        ],
      },
    ];
  },
};

export default nextConfig;
