/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Resolve metadata/notFound before streaming so missing videos return HTTP 404.
  htmlLimitedBots: /.*/,
  allowedDevOrigins: ["*.e2b.app"],
  poweredByHeader: false,
  compress: true,
  // Frame thumbnails run a bundled ffmpeg binary. Keep the package out of the
  // webpack bundle and ship the linux-x64 binary with the routes that use it.
  serverExternalPackages: ['@ffmpeg-installer/ffmpeg', '@ffmpeg-installer/linux-x64'],
  outputFileTracingIncludes: {
    '/api/admin/videos/thumbnails': ['./node_modules/@ffmpeg-installer/linux-x64/**/*'],
  },
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
      // Streamtape player pages and splash thumbnails.
      { protocol: 'https', hostname: 'streamtape.com' },
      { protocol: 'https', hostname: '**.streamtape.com' },
      { protocol: 'https', hostname: 'tapecontent.net' },
      { protocol: 'https', hostname: '**.tapecontent.net' },
      // Retired UFOLOAD posters on legacy videos — historical rows keep rendering.
      { protocol: 'https', hostname: 'ufoload.com' },
      { protocol: 'https', hostname: '**.ufoload.com' },
      { protocol: 'https', hostname: '**.resend.com' },
    ],
  },
  async headers() {
    return [
      ...['/admin/:path*', '/advertiser/:path*', '/auth/:path*', '/api/:path*'].map(source => ({
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
