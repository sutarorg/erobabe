# EroBabe API layer (`/server`, `/api`, `/netlify/functions`)

Provider-agnostic secure API used when `VITE_DEMO_MODE=false`.

| File | Role |
| --- | --- |
| `server/app.ts` | The entire router: auth, sessions, rate limiting, Supabase access, R2 presigning, processing-provider abstraction, public + admin endpoints. |
| `api/handler.ts` | Vercel adapter (mounted at `/api/*` by `vercel.json`). |
| `netlify/functions/api.ts` | Netlify Functions adapter (mounted via `netlify.toml`). |

## Server-only dependencies

The frontend build does **not** include this folder. When deploying with the
API enabled, also install:

```bash
npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
```

These are imported dynamically, so nothing breaks if they are absent until you
enable R2 uploads.

## Endpoints

Public (published content only):

```
GET  /api/videos?sort=&category=&limit=
GET  /api/videos/:idOrSlug
GET  /api/categories
GET  /api/trending
GET  /api/popular
GET  /api/featured
GET  /api/search?q=
POST /api/views
```

Admin (HttpOnly session required):

```
POST   /api/admin/login            POST  /api/admin/upload/init
POST   /api/admin/logout           POST  /api/admin/upload/sign-part
GET    /api/admin/me               POST  /api/admin/upload/complete
GET    /api/admin/stats            POST  /api/admin/videos/:id/publish
GET    /api/admin/videos           POST  /api/admin/videos/:id/unpublish
POST   /api/admin/videos           GET   /api/admin/analytics?days=
PATCH  /api/admin/videos/:id       GET   /api/admin/storage
DELETE /api/admin/videos/:id       GET/PUT /api/admin/settings
...categories/tags CRUD            GET   /api/admin/activity
```

## Media flow

```
admin browser ──(1) POST /admin/upload/init──► API validates type/size
API ──(2) multipart UploadId + presigned part URLs ──► browser
browser ──(3) PUT parts──► Cloudflare R2 (direct, bytes skip the server)
browser ──(4) POST /admin/upload/complete ──► API finalizes + row (PROCESSING)
API ──(5) VideoProcessingProvider.createJob() ──► FFmpeg worker (if configured)
worker ──(6) renditions + HLS + poster ──► R2 encoded/{id}/…
admin clicks PUBLISH ──(7) status=PUBLISHED ──► public API serves it instantly
```

If no processing provider is configured the API reports
`processing: "not-configured"` and the original MP4 is used as a
single-source playback URL — the admin UI surfaces this honestly instead of
faking renditions.
