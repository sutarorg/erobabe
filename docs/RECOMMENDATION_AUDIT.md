# Recommendation system repository and workflow audit

**Audited:** 16 October 2026. **Checkout:** `arena/ed424d83-erobabe`, based on `af2734b` (merge commit from main); clean before this work. Repository history has 24 forward migrations through `00000000000023_remove_comment_cooldown.sql`. No production database credentials or live data were available, so live schema drift and actual catalog size remain unverified. The existing `docs/WORKFLOW_MAP.md`, `docs/ENVIRONMENT_AUDIT.md`, implementation/launch audits, migrations, routes, components, and tests were inspected.

## 1. Actual production lifecycle

1. **Admin publishing:** the real upload workflow is under `app/admin/(dashboard)/videos/upload` and Bunny upload/API routes. Migrations 12–16 stage and validate provider completion; upload completion reaches `pending_review`/private. Admin review code and rights evidence are separate. Migration 19 contains auto-publish paths and must be considered when reasoning about publication, but recommendation code never authorizes publication.
2. **Public eligibility:** production public catalog uses all of: `status='published'`, `visibility='public'`, `rights_status='cleared'`, `moderation_status='approved'`, and `requires_reupload=false`. Public page and feed queries need to preserve those gates. Some SQL functions repeat the same checks. The catalog currently does not consistently require a usable playback identity in its common eligibility helper; the recommendation candidate query must.
3. **Catalog/category:** `lib/public/catalog.ts` uses `unstable_cache` for public content (80-row listing/popular caches and 30-second revalidation). `getPublishedVideos()` and `getPopularVideos()` are bounded at 80; homepage splits that sample into shelves. `getCategoryBySlug()` queries independently. These cache semantics are suitable for public shared catalog data, not personalized output.
4. **Homepage:** `app/(public)/page.tsx` obtains published sample, public categories, and the administrator-managed carousel in parallel. The hero remains admin-selected through `getCarouselVideos()` and `heroSlidesFromCarousel`. `homeSections()` currently puts newest half into Latest and selects Featured from the remainder ordered by raw view count. Featured is neither an independent eligible feed nor editorial content; both sections depend on the first 80 newest items.
5. **Listings:** `/latest` uses the cached newest 80, with no pagination. `/popular` is actually “Most Viewed” ordered by raw `view_count`, not rated. Card view labels likewise show recorded views.
6. **Watch page:** production route is `app/(public)/video/[slug]/page.tsx`, server-side loads the actual video with publication/rights/moderation/reupload checks, then separately queries same-category videos and calls `watchFeed('recommended')` and `watchFeed('rated')`. It displays “More like this”, “Recommended”, and “Top Rated”, and mounts the chronological lazy `LatestVideoFeed`. It does not import `src/components/VideoPage.tsx`; that file is legacy/demo UI and has no production import. Avoid connecting its demo rows or behavior to the production route.
7. **Playback:** `src/components/VideoPlayer.tsx` supports native `<video>` direct media and Bunny iframe embeds, plus older embed handling. Native video currently handles play/loading/errors but does not send recommendation analytics. Bunny iframe autoplays and only its iframe load/error are observed; this is not evidence of playback. Bunny's documented Player.js interface exposes play/pause/timeupdate/ended/error and could support richer events if integrated; production credentials were unavailable.
8. **Views and social:** `ViewTracker` waits five visible foreground seconds (and checks the age-gate overlay), then calls `/api/track/view`. That records a qualifying page visit, not actual playback or completion. The route is rate limited and calls the service-only `record_video_view` RPC. Migration 15's view aggregate stores hashed visitor/video pairs (existing retention behavior must be checked operationally). `video_likes` is a unique `(video_id, visitor_hash)` toggle and `videos.like_count` is its aggregate (migration 21). This is a binary like, not numeric rating. `/api/community` handles likes and comments; it receives a client `visitorId` for the existing community feature and HMACs it server-side. Comment identity and recommendation identity must remain separate.
9. **Feed API:** `/api/videos/feed` only invokes latest, validating exclude UUID/date+id/limit; `LatestVideoFeed` uses it as an infinite-feed endpoint with date/id cursor. `watchFeed()` has latest, recommended (raw views), and rated (raw like_count) modes. It orders non-latest modes by views/likes and then publication timestamp, but applies a published-date/id cursor to all modes. That cursor does not match the leading sort order and can skip/duplicate records. The existing feed query does include all standard publication gates but does not validate a playable identity. The modes are not genuine user personalization.
10. **Autoplay/age gate:** Bunny embed currently explicitly has `autoplay=true`; it is an existing behavior, not user-controlled autoplay preference. The app has age-gate/parental-control routes and mature content policy; age assurance and adult-only hosting compliance still require separate operational/legal review. Recommendations must not weaken age restrictions.

## 2. Schema and capabilities

- `videos` has one `category_id`, title/description, publication status, rights/moderation/reupload flags, provider identifiers, playback URLs, view_count, and carousel slots. A normalized `tags`/`video_tags` schema exists in the initial migration. No evidence was found of a numeric rating/review table.
- `video_likes` plus `like_count` provide unique toggled positive community feedback, not a rating. The visitor hash is part of the like key. Duplicate RPC submissions are logically idempotent via the unique key and count delta.
- The older general `video_events` table is not a trusted source for recommendation behavior; migration 14 drops anonymous insert policy. The newer view tracking is a dedicated measured aggregate. There are no recommendation impression, playback milestone, persistent consent, per-viewer dismiss, or profile-preference tables.
- The existing `limitRequest` utility uses server HMAC and `request_limits` RPC. Server-side mutation routes use service credentials; these must never enter browser code. Service-role RLS bypass means every route needs strict validation and the same eligibility check.
- There is an adult age gate in client/UI behavior and policy language, but this repository inspection cannot certify a jurisdiction-specific age-assurance system or legal sufficiency.
- Public caches use `unstable_cache`; personalized feed responses must be dynamic/no-store and must not go through shared cached catalog functions.

## 3. Existing tests and dependency footprint

- The production watch route is exercised by `tests/unit/video-page.test.tsx`; feed component tests exist in `tests/unit/latest-video-feed.test.tsx`; community, publication safety, launch integrity, and public listing tests exist. E2E suite includes auth, Bunny media, payments, navigation and SEO. Unit tests use `vitest`/mock Supabase, and the repository contains PGlite migration tests for other features.
- Next 15 App Router, TypeScript, Supabase SSR/service client, React 19, Zod, Vitest, Playwright. `npm run type-check`, `npm run lint`, `npm test`, `npm run build`, and `npm run test:e2e` are available; E2E needs browser/runtime setup and some real integration paths need secrets.
- Existing page tests assert historical page text and output; changing a section label (e.g., Top Rated to Most Liked) requires corresponding tests and product copy updates.

## 4. Risks and safe implementation path

### Confirmed bugs/limitations

- Non-latest `watchFeed()` pagination uses a date cursor with non-date primary ordering.
- API route hardcodes latest; it cannot provide genuine feed modes.
- Home Featured/Latest overlap is avoided only within a bounded 80-record newest sample; low-view recent content is classified as latest while older established material is excluded from Featured retrieval.
- Raw popularity counts are biased by item age/exposure and lack small-sample confidence; views are not satisfaction.
- Current “Top Rated” wording misrepresents a like count. `/popular` correctly says Most Viewed.
- Page visit events do not equal actual playback. Bunny iframe `onLoad` does not prove player-ready or play.
- Tags exist but are not used in current recommendation query. No co-watch aggregate exists; insufficient data is not permission to invent collaborative behavior.
- The public catalog has bounded samples; a recommender must retrieve through database queries/indexes, not reuse that sample as the full catalog.
- `LatestVideoFeed` calls the route without mode, currently appropriate for chronological latest. Any shared route extension must preserve its current params and response shape.

### Smallest safe migration path

1. Keep public eligibility centralized in server-side query building and explicitly include a playable identity check for recommendation/watch candidates; preserve current publication/admin checks.
2. Make `/latest` genuinely keyset-paginated by `(published_at, id)` and ensure its query has identical sort/cursor order. Keep all non-latest ranked endpoints separately bounded and do not reuse a timestamp cursor for score order.
3. Build a pure, versioned scoring/reranking module. Sources should be indexed category/tag/context queries, explicit preferences/feedback only with consent, plus recent and aggregate like/popularity candidates. Keep deterministic tie-breakers. No per-request model API.
4. Add a forward migration after 23 for minimal recommendation consent/preferences, feedback/suppression, pseudonymous event data, and supporting indexes/RLS. Do not reuse anonymous-comment visitor hashes. Make reset/opt-out real, and define retention deletion.
5. Add validated, rate-limited server endpoints with no-store for recommendation retrieval and feedback/events. Service role only server-side. Record impression context only when rendered client-side through a real request; do not log IDs/history into application logs.
6. Integrate Up Next into the watch route, make homepage Featured distinguish editorial carousel from discovery shelves, and retain the stable chronology of Latest. Replace unsupported “Top Rated” text by “Most Liked” unless a genuine rating system is separately introduced.
7. Instrument native media events and Bunny Player.js only if the integration is safely testable; otherwise collect no completion/watch-time signal. Distinguish playback error from early exit.
8. Keep payment, advertising, publishing, search, category navigation, comments, like toggle, SEO and admin carousel behavior untouched.

## 5. Limits of this audit

No production Supabase schema/data, Vercel deployment, Bunny account, or realistic catalog fixture was accessible. We therefore cannot claim the live migration history, playback reliability, content coverage, query latency, or algorithm effectiveness. The deployment runbook must apply the new forward migration and validate query plans, RLS and server-only access against staging before enabling persistent profiling. Age assurance and rights/moderation evidence remain operational and legal responsibilities, not properties proven by recommendation code.

## 6. Implementation resolution on this branch (16 October 2026)

The baseline above describes the pre-change production behavior. The current branch now adds the service and UI described in `RECOMMENDATION_ALGORITHM.md`:

- `lib/recommendations/ranking.ts` contains the pure, versioned ranker; `lib/recommendations/service.ts` performs bounded retrieval from eligible real Supabase rows, context/category/tag and popularity/freshness sources, consented profile signals, and surface-specific keyset behavior.
- Migration `00000000000024_recommendations.sql` adds server-only consent/preferences, explicit feedback, short-lived recommendation events, candidate indexes, idempotency, and server-only SQL functions. It is forward-only; it has **not** been applied to production in this session.
- `/api/videos/feed` now keeps the old default latest URL behavior and also selects explicit surfaces; `/latest` uses a stable publication-time/UUID keyset. Preference, feedback, event and retention endpoints are bounded/validated/rate-limited; personalized responses are no-store.
- Homepage retains the admin hero carousel and adds separate algorithmic Featured and cold-start/consented Recommended shelves. Watch page adds contextual Up Next, Recommended and Most Liked. “Top Rated” was corrected because there is no numeric rating system.
- Native media events and Bunny's documented Player.js iframe events provide observed start/progress/end/error data. Bunny autoplay is off unless a visitor explicitly enables a local player setting. Bunny integration was unit-tested/mocked, not verified against a live library/account.
- Recommendation profile identifiers are independent from the existing anonymous comment/like IDs; feedback opt-in, reset, pause/delete and 30/180-day cleanup are in code and documentation. A daily GitHub Actions cleanup workflow requires operator secrets.

The repository still contains no historical recommendation impressions, co-watch aggregates, trend time-series, production dataset, or credentials. Thus no performance benchmark, data-driven optimal weights, live Bunny acceptance, user-level lift, experiment result, or production migration is claimed. Ranked shelves currently render one bounded batch; the API has a deterministic score keyset, but ranked infinite-scroll stability under signal changes needs snapshot cursor work before that UI is enabled. Latest pagination remains independent and chronological.
