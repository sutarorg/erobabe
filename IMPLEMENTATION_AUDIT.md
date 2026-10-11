# IMPLEMENTATION_AUDIT.md — Erobabe Pre-Implementation Audit (10 Oct 2026)

> **Note (2026-10-11):** this is the historical pre-implementation audit of the original
> Vite SPA. References to Bcon Global and Groq below describe the providers as they
> existed at audit time. The active application has since migrated to NOWPayments for
> cryptocurrency payments and Google's Gemini API for AI metadata — see
> `IMPLEMENTATION_REPORT.md`, `DEPLOYMENT.md`, and `GO_LIVE_CHECKLIST.md` for the
> current implementation.


This document inventories the existing repository before transformation.

## Repository Root

### `package.json` / `package-lock.json`
- **Responsibility**: Defines Vite + React 19 + Tailwind 4 project. Scripts: dev, build, preview.
- **Mock dependencies**: None, but missing critical deps: next, supabase, resend, groq-sdk, etc.
- **Interactions**: Entry for Vite build.
- **Intended production**: Needs migration to Next.js or SSR framework, add backend deps, scripts for type-check, lint, test.
- **Action**: Modify — replace Vite single-file build, add dependencies, add test scripts.

### `index.html`
- **Responsibility**: Single HTML shell with generic title "erobabe — Advertiser Portal", meta description generic, adult rating, favicon external URL, Google Fonts.
- **Mock**: Title misleading (says Advertiser Portal while default route is admin). No dynamic metadata, no OG tags, no canonical, no VideoObject, no sitemap link.
- **Intended**: Must become Next.js app with dynamic metadata per route, unique titles, canonicals, OG, JSON-LD, robots handling.
- **Action**: Replace with Next.js layout and metadata system. Preserve favicon URL.

### `vite.config.ts`
- **Responsibility**: Vite config with react, tailwindcss, vite-plugin-singlefile.
- **Issue**: singlefile plugin bundles everything into one file — incompatible with SSR, dynamic sitemap, per-page metadata, SEO. No code-splitting.
- **Action**: Remove. Replace with Next.js config.

### `tsconfig.json`
- **Responsibility**: TS config, path alias @ -> src.
- **Action**: Modify for Next.js (include app directory, jsx, etc).

### `src/main.tsx`
- **Responsibility**: React root mounting App.
- **Action**: Remove in Next.js migration; entry becomes app/layout.tsx.

### `src/App.tsx`
- **Responsibility**: Hash router shell: parses window.location.hash, routes to #/admin (default), #/advertise, #/site and subpaths. Callbacks go() sets hash.
- **Mock**: Entire routing is client-side hash — not crawlable, no HTTP status codes, no SSR, SEO broken, direct linking fragile, canonical wrong.
- **Intended**: Normal URLs: / , /video/[slug], /admin/*, /advertiser/* with nested routes, protected routes, server rendering.
- **Action**: Replace with Next.js App Router file-system routing, middleware for auth, layout for each area.

### `src/index.css`
- **Responsibility**: Design tokens (void, panel, rail, card, ink, accent #f51655), typography Inter, layout helpers for ad slots (16:9, fits 5 per viewport), scrollbars, video grid, animations.
- **Mock**: None, but scrollbar hiding may affect accessibility.
- **Intended**: Preserve tokens, adapt to Next.js globals.
- **Action**: Retain, migrate to app/globals.css, ensure accessibility.

### `src/data/content.ts`
- **Responsibility**: Mock video dataset (30 videos), categories (8 + 5 extra), hero slides, featured IDs, latest sorting. Helper px() builds Pexels stock image URLs. categorySlug helpers.
- **Mock inventory**: VIDEOS array with fake titles, hardcoded views, daysAgo, ratings, Pexels thumbs, descriptions — all fictional. FEATURED_VIDEOS, LATEST_VIDEOS derived from mocks. CATEGORIES icons.
- **Interactions**: Used by PublicSite, VideoPage, BrowseView, Hero, Categories, etc.
- **Intended**: Real DB-backed videos, real taxonomy managed by admin, real thumbnails from provider, no Pexels placeholders.
- **Action**: Remove mock VIDEOS. Keep category taxonomy structure but move to DB seed (12 categories). Keep LOGO_URL. Keep categorySlug helpers (useful for URL). Remove px helper.

### `src/hooks/useGridColumns.ts`
- **Responsibility**: Measures container width to compute grid columns, shares source of truth between CSS and rendered item count.
- **Mock**: None.
- **Intended**: Still useful for responsive grids, but may be replaced by CSS grid auto.
- **Action**: Retain or adapt.

### `src/utils/cn.ts`
- **Responsibility**: clsx + tailwind-merge helper.
- **Action**: Retain.

---

## Public Website Components (`src/components/*`)

### `PublicSite.tsx`
- **Responsibility**: Central public site shell: parses path, handles search query local state, likedIds local, user fake {name}, signInOpen, scroll refs, navigation callbacks. Renders AdRail left/right, Header, conditional BrowseView, VideoPage, static pages, Hero, Categories, VideoGrid, InlineAd, Footer, SignInModal, AgeGate.
- **Mock**: likedIds local only, user fake, search client-side filter on VIDEOS mock, activeVideo lookup from mock VIDEOS, listVideos sorting by rating/viewsNum mock, featured/latest from mock slices. No backend, no pagination, no real view counts.
- **Intended**: Real DB queries: latest, featured, categories, video by slug, search, pagination. Real auth optional. Remove likes/saved unless scoped.
- **Action**: Modify heavily — keep layout but connect to real data via props from server components.

### `VideoPage.tsx`
- **Responsibility**: Watch page for single video: placeholder player (img + play button), progress bar demo, metadata (views, added, duration), like/save/share buttons, category chips, description, sections More like this / Recommended / Top Rated / Top Categories / Latest infinite.
- **Mock**: Player is styled placeholder, no media streaming. Views, rating fake. More like this uses mock filtering. SeededOrder deterministic shuffle. InfiniteVideoGrid uses mock pool. Description demo text. Share copies window.location.href (hash URL). Demo warning text "Demo watch page — placeholder".
- **Intended**: Real provider embed or playable URL, real duration, quality, actual related videos, real view event recording, JSON-LD VideoObject, SEO metadata.
- **Action**: Replace player with real provider component, remove demo warning, connect to DB.

### `VideoCard.tsx` / `VideoGrid.tsx` / `VideoSection.tsx` / `InfiniteVideoGrid.tsx`
- **Responsibility**: Card UI, grid wrapper, section header, infinite scroll simulation.
- **Mock**: VideoCard uses thumb from Pexels, duration, quality, views, rating — all mock. InfiniteVideoGrid simulates fetch with timer, skeletons, reuses same pool to simulate endless.
- **Action**: Keep UI, but feed real video records, real empty states, remove simulated fetch timers.

### `BrowseView.tsx`
- **Responsibility**: Listing page with eyebrow, title, filter chips, VideoGrid, clear button.
- **Mock**: Videos from mock list, no pagination, no empty state handling for DB empty.
- **Action**: Modify to support real queries, pagination, empty states.

### `Categories.tsx` / `CategoriesPage.tsx`
- **Responsibility**: Category tiles with icons, "More" shortcut.
- **Mock**: Uses CATEGORIES mock, counts not real.
- **Action**: Keep UI, use real categories from DB with real counts.

### `Hero.tsx`
- **Responsibility**: Carousel with 3 slides, Pexels images, eyebrow/headline/sub.
- **Mock**: Images are Pexels stock, not licensed for adult site. Content fictional.
- **Intended**: Keep layout but replace with owned/licensed promotional artwork or real featured videos.
- **Action**: Modify to use real data or properly licensed hero.

### `AdRail.tsx` / `AdSlot.tsx` / `InlineAd.tsx`
- **Responsibility**: Left/right rails (5 slots each, hidden <1000px), AdSlot vacant placeholder with "Advertise" CTA, InlineAd for mobile.
- **Mock**: No real campaign data, no creative, no impression tracking, no availability check.
- **Intended**: Query active campaign per slot, render approved creative 16:9, preserve ratio, show "Available $99/month" if vacant, real impression/click tracking, validate URLs.
- **Action**: Modify to accept real campaign/creative props, keep 16:9 CSS.

### `Header.tsx`
- **Responsibility**: Nav (home, categories, latest, top rated, browse), search input, menu, user sign-in/out fake.
- **Mock**: user prop fake {name}, sign-in triggers SignInModal local, search is local state.
- **Action**: Connect to real auth, remove fake user, implement crawlable <a href> links.

### `Footer.tsx`
- **Responsibility**: Footer links, advertise CTA, admin link.
- **Mock**: Contains fake legal claims, .example emails, future-dated demo policy revisions (per StaticPages).
- **Action**: Preserve layout, fix legal content, use real contact details from settings.

### `StaticPages.tsx`
- **Responsibility**: About, Terms, Privacy, Contact, FAQ, Removal pages.
- **Mock**: Fake company name, address, statistics, .example emails, future dates, fictional claims.
- **Action**: Replace with accurate operational terms using verified business details, document TODOs for legal review.

### `AgeGate.tsx`
- **Responsibility**: 18+ confirmation saved in localStorage, sits above all layers.
- **Mock**: Frontend only, not robust age assurance, no jurisdiction handling, no bot verification.
- **Intended**: Keep gate but document legal requirements, consider Googlebot verification for SEO without bypassing legal obligations.
- **Action**: Modify to set cookie, handle robots.txt, document blocker.

### `SignInModal.tsx`
- **Responsibility**: Fake sign-in modal with email/password placeholders, no backend.
- **Mock**: Simulates sign-in, returns name string, no validation, no Supabase.
- **Action**: Replace with real Supabase auth flows or remove if public viewer registration not in scope.

---

## Admin Portal (`src/admin/*`)

### `AdminApp.tsx`
- **Responsibility**: Admin shell: state for videos, categories, playlists, ads, slots, advertisers, reports, users, logs, settings, notices all from INITIAL_* mocks. Overlays: VideoDrawer, SlotModal, ReportModal, AdDialog, CreateSlotDialog, AdvertiserDialog. Toast system. Navigation via AdminSidebar. Functions saveVideo, duplicateVideo, toggleVideoStatus, publishUpload (simulated), saveSlot, createSlot, saveReport, toggleSuspendAdvertiser, addAdvertiser, setAdStatus, addAdvertisement — all local setState only.
- **Mock**: All entity state local, no backend, no auth, no RLS, publishUpload inserts mock records with description "Simulated ... Nothing was transmitted anywhere". No real upload, no provider. Toast "local state only".
- **Intended**: Real Supabase queries/mutations, real upload via provider adapter, real audit logs, protected routes, role checks.
- **Action**: Replace state with real data fetching, connect to backend, preserve UI layout.

### `data.ts`
- **Responsibility**: Mock datasets: INITIAL_VIDEOS (12 videos, Pexels thumbs, fake views), INITIAL_SLOTS (10 fixed), INITIAL_ADS (6 with example.com URLs), INITIAL_ADVERTISERS (6), INITIAL_CAMPAIGNS (8), INITIAL_PAYMENTS (8 with Visa ••••), INITIAL_REPORTS (6), INITIAL_USERS (8 with erobabe.com emails), INITIAL_LOGS (10), INITIAL_CATEGORIES (12 with fake video counts), INITIAL_PLAYLISTS (3), PENDING_* queues, REVENUE mock spark data, ADMIN_NOTICES, INITIAL_SETTINGS.
- **Mock**: All fake, example.com URLs, fictional metrics, hardcoded wallet, etc.
- **Intended**: Only legitimate baseline: 10 fixed ad placements, category taxonomy (12 categories). All other seed data must be removed, empty states honest.
- **Action**: Remove file or replace with real types only. Create SQL seed for slots and categories.

### `AdminSidebar.tsx`
- **Responsibility**: Sidebar nav for admin views: dashboard, upload, videos, categories, playlists, ads, slots, advertisers, campaigns, payments, reports, users, settings, logs, health. Shows logo.
- **Action**: Retain UI, update routes to /admin/*, add role-aware nav.

### `DashboardView.tsx`
- **Responsibility**: Dashboard with stats, recent videos, slots overview, reports, notices, quick actions.
- **Mock**: Stats from mock arrays length, revenue spark mock, views spark mock, hardcoded uptime/latency/incidents.
- **Action**: Connect to real aggregates, remove hardcoded metrics, show "Unknown" if unavailable.

### `VideosView.tsx` / `VideosTable.tsx`
- **Responsibility**: List, search, filter videos, actions preview/edit/duplicate/toggle.
- **Mock**: Uses mock videos, local search, no pagination, no real processing status.
- **Action**: Connect to real DB, implement search, filter, pagination, real status.

### `UploadView.tsx`
- **Responsibility**: Bulk upload UI with 3 tabs: file, iframe, link. QueueItem with phase uploading/probing/ready, progress bar simulated via timers, probeMedia() deterministic fake duration/quality from seed string, makeItem, runIngest timers, bulk text extractors, thumbnail selection.
- **Mock**: All frontend simulations, files never leave browser, links never fetched, embeds not rendered from remote origins, progress bars timers, probing fake, description "Nothing was transmitted anywhere".
- **Intended**: Real upload via provider adapter, progress where protocol exposes it, rights-clearance workflow, Groq metadata suggestions, validation, retry, cancellation.
- **Action**: Rewrite to use real upload API, preserve drag-drop and UI, remove probeMedia simulation.

### `Modals.tsx`
- **Responsibility**: VideoDrawer (preview/edit), SlotModal, ReportModal, AdDialog, CreateSlotDialog, AdvertiserDialog, plus pending queues modals.
- **Mock**: Forms with placeholder examples like "e.g. EroAds Media", mock queue "local decisions only", "Create a mock advertiser account".
- **Action**: Connect to real mutations, validation, confirmation dialogs.

### `AdViews.tsx` / `BusinessViews.tsx` / `ContentViews.tsx` / `ModerationViews.tsx` / `SystemViews.tsx` / `widgets.tsx`
- **Responsibility**: Various admin screens: ad creatives list, slots list, advertisers, campaigns, payments, categories, playlists, reports, users, settings, logs, health.
- **Mock**: All display INITIAL_* data, static metrics, mock telemetry "static mock values for frontend demo. No live checks", price changes "update mock rate card for this session only".
- **Action**: Connect to real data, remove mock telemetry, implement real health checks or "Unknown".

---

## Advertiser Portal (`src/portal/*`)

### `PortalApp.tsx`
- **Responsibility**: Advertiser shell: hash sub-routing, local state slots/campaigns/transactions/invoices/notices/profile/wallet/spent from INITIAL_*, drawer for slot, modals, toast, navigation. Functions handleReserve, handleCreateCampaign (deducts wallet locally), etc.
- **Mock**: All local, wallet top-up fake Visa •••• 4242, wallet balance invented, campaign creation immediate without approval, no backend, no payment verification.
- **Action**: Replace with real Supabase auth, real slot inventory query, real campaign creation with reservation concurrency, real Bcon payment flow, remove wallet top-up if not needed.

### `data.ts`
- **Responsibility**: Mock advertiser data: INITIAL_SLOTS (10 with active/available, advertiser names, estImpr, ctr), INITIAL_CAMPAIGNS (7 with pending/active/completed/rejected), INITIAL_TRANSACTIONS (5 with Visa), INITIAL_WALLET 1245.8, INITIAL_SPENT 297, INITIAL_INVOICES (6), INITIAL_NOTICES (4), PERF analytics mock, TOP_SLOTS, TRAFFIC_SOURCES, INITIAL_PROFILE (EroAds Media), FAQS.
- **Mock**: All fake metrics, hardcoded balances, Visa placeholders, fictitious notifications.
- **Intended**: Real slots from DB, real campaigns per advertiser, real payments/invoices from Bcon, real analytics from event tables.
- **Action**: Remove, replace with real types and empty states.

### `PortalApp` sub-views: `DashboardView.tsx`, `SlotsView.tsx`, `SlotDrawer.tsx`, `CreateCampaignView.tsx`, `CampaignsView.tsx`, `BillingViews.tsx`, `AnalyticsView.tsx`, `AccountViews.tsx`, `Sidebar.tsx`, `PerformanceChart.tsx`, `Modals.tsx`, `ui.tsx`
- **Responsibility**: Dashboard with spend/impressions, slots grid, slot drawer with reservation, campaign creation form (name, slot, duration, creative upload, destination URL), campaigns table, billing (transactions, invoices, wallet), analytics charts, account profile, support.
- **Mock**: Spend/impressions hardcoded, slots availability local, creative upload simulated, wallet charges simulated, Visa placeholders, static analytics arrays, fictitious notifications, mock profile.
- **Intended**: Real data, real reservation conflicts via DB transactions, real creative validation (16:9, file types), real payment request creation, pending/confirmed states, campaign approval, invoice display, expiration.
- **Action**: Connect to real backend, implement loading/empty/error states, remove fake wallet if not needed, simplify billing to Bcon flow.

---

## Cross-Cutting Issues

- **Mock/demo inventory**: 30+ occurrences of INITIAL_*, mock, simulated, example.com, Visa ••••, fake ratings, hardcoded balances.
- **Auth**: Fake sign-in, no Supabase, no RLS, no protected routes, self-assigned roles possible.
- **Upload**: Simulated, no provider, Uqload TOS prohibits adult content — blocker.
- **Payments**: Fake card, wallet invented, no Bcon integration, no callback verification, no idempotency.
- **Video playback**: Placeholder player, no embed URL, no provider.
- **SEO**: Hash routing, generic index.html, no sitemap, no robots.txt, no VideoObject, no canonical, no SSR, no crawlable <a>.
- **Security**: No RLS, no server auth, no rate limiting, no URL validation, secrets exposed risk.
- **Accessibility**: Modals not keyboard accessible, scrollbar hidden may hide content, no focus traps.
- **Build**: vite-plugin-singlefile prevents dynamic metadata.
- **Legal**: Fake company identity, .example emails, future-dated policies, demo warnings.

---

## Architecture Decision

- **Current**: Vite SPA, hash routing, singlefile, all mock local state.
- **Required**: SSR or prerender for SEO, dynamic metadata, sitemap, robots, VideoObject, crawlable URLs, HTTP status codes.
- **Decision**: Migrate to Next.js App Router (justified by SEO acceptance criteria). Preserve React components, Tailwind styling, visual identity. Implement Supabase for auth/DB, server-side API routes for Bcon/Resend/Groq/video upload adapter. Document hosting blockers: Vercel Hobby unsuitable, Uqload TOS prohibits adult content.

---

## File Action Summary

- Retain: index.css (as globals.css), utils/cn.ts, hooks/useGridColumns.ts (adapt), components visual UI (AdRail, AdSlot, Header, Footer, etc) with modifications, portal/ui.tsx with modifications.
- Modify: App.tsx -> Next.js routing, PublicSite.tsx -> server components, VideoPage.tsx -> real player, all admin/portal views to use real data.
- Remove: src/data/content.ts mock VIDEOS, src/admin/data.ts mock datasets, src/portal/data.ts mock datasets, SignInModal fake, InfiniteVideoGrid simulated fetch.
- Replace: vite.config.ts, index.html, main.tsx with Next.js equivalents, plus new lib/supabase, lib/bcon, lib/video, lib/resend, lib/groq, migrations, tests, docs.

---

## Next Steps

1. Scaffold Next.js app, install deps.
2. Create Supabase schema migrations with RLS.
3. Implement auth, roles, protected routes.
4. Implement video provider abstraction with Uqload adapter but disabled for production due to TOS.
5. Implement Bcon payment flow server-side.
6. Implement Resend and Groq server-side.
7. Rebuild public site with real data, SEO, sitemap, robots, VideoObject.
8. Rebuild advertiser and admin portals with real data.
9. Remove all mock/demo data, add honest empty states.
10. Add tests, docs, env example.
11. Production QA.

