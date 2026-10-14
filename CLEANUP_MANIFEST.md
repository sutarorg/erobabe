# Cleanup manifest

## Confirmed retired SPA

Evidence: scripts run Next only; App Router does not import these roots. `index.html` was the sole entry to `src/main.tsx`, which imported App, hash-routed PublicSite, and the mock admin/portal trees. `src/index.css` was imported only by main; production uses app/globals.css. TypeScript already excluded these SPA roots. All files in these roots were checked for outside references. Shared src/components, src/data, src/utils and tests remain, including upload/thumbnail utilities, FFmpeg, and legacy media playback. No applied migration was removed.

Removed files:

- `src/admin/AdViews.tsx`
- `src/admin/AdminApp.tsx`
- `src/admin/data.ts`
- `src/admin/AdminSidebar.tsx`
- `src/admin/BusinessViews.tsx`
- `src/admin/ContentViews.tsx`
- `src/admin/DashboardView.tsx`
- `src/admin/Modals.tsx`
- `src/admin/ModerationViews.tsx`
- `src/admin/SystemViews.tsx`
- `src/admin/UploadView.tsx`
- `src/admin/VideosTable.tsx`
- `src/admin/VideosView.tsx`
- `src/admin/widgets.tsx`
- `src/portal/AccountViews.tsx`
- `src/portal/AnalyticsView.tsx`
- `src/portal/BillingViews.tsx`
- `src/portal/CampaignsView.tsx`
- `src/portal/CreateCampaignView.tsx`
- `src/portal/DashboardView.tsx`
- `src/portal/Modals.tsx`
- `src/portal/PerformanceChart.tsx`
- `src/portal/PortalApp.tsx`
- `src/portal/Sidebar.tsx`
- `src/portal/SlotDrawer.tsx`
- `src/portal/SlotsView.tsx`
- `src/portal/data.ts`
- `src/portal/ui.tsx`
- `src/App.tsx`
- `src/PublicSite.tsx`
- `src/main.tsx`
- `src/index.css`
- `index.html`
- `tsconfig.tsbuildinfo`

`tsconfig.tsbuildinfo` is generated compiler cache; ignored by `*.tsbuildinfo`. No direct dependency was removed as unused; test-runner upgrades replace their own transitive dependency tree.

- `src/components/StaticPages.tsx`: only imported by the retired PublicSite; its old contact/report forms used demo behavior and portal/ui. The real App Router legal/contact/removal routes are separate. Verified no production or test imports before removing this transitive orphan.

## Configuration and relocation

- Removed unused `SITE_URL` and commented `NEXT_PUBLIC_POSTHOG_KEY` example settings after searching runtime references; canonical identity actually reads `NEXT_PUBLIC_SITE_URL`. No deployed secret was deleted.
- `app/(public)/loading.tsx` relocated to shared `src/components/PublicLoading.tsx`, re-exported by catalog routes. This is not removed functionality: scoping the suspense boundary away from watch routes prevents premature HTTP 200 for missing videos.
- Old advertiser payments/invoices URLs remain as redirects; table implementations live once under Billing. No billing feature was deleted.

Dependency changes are security updates, not guessed dead-code removals: Next 15.5.28, Vitest 4.1.11, esbuild 0.28.2, PostCSS 8.5.30 override. Vitest's new transitive tree removes the old vulnerable worker/mocker chain; no direct business dependency was removed. Browser tooling used for local acceptance is outside the repository/dependency manifest.
