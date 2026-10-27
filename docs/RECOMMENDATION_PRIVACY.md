# Recommendation privacy and security

> **Historical document (superseded 2026-10-27).** Video uploads and Bunny
> Stream are retired. This file is kept for provenance; read
> `docs/DAMPLIPS_EMBEDS.md` for the current catalog flow (damplips embeds,
> `npm run import:damplips`, `/api/videos/stream`).

**Applies to:** recommendation profile, feedback, and measurement introduced in migration `00000000000024_recommendations.sql`. The public catalog remains browseable without profiling or an account. Adult viewing data is treated as sensitive even if pseudonymous.

## Data collected

Personalization is **on by default** (changed 2026-10-27: the in-page
"Recommendation controls" panel was removed at the product owner's request).
`src/components/RecommendationProfileInit.tsx` asks the server for a profile
token on the first public page view of a session; there is no opt-in click. A visitor can still opt out through
`POST /api/recommendations/preferences` with `{"action":"disable"}`, which deletes
the profile rows and the cookie, and a stored `personalization_enabled = false`
row is honoured for its 180-day lifetime. Treat turning adult viewing
personalization on by default as a **legal/consent decision that needs privacy
counsel review**, not just an implementation detail.

What is stored under that profile:

- A random opaque first-party token is placed in an `HttpOnly`, `SameSite=Lax`, path-wide cookie, with `Secure` in production and a 180-day browser expiry. The token is never exposed to client JavaScript and is not the existing anonymous comment/like identifier.
- The server HMACs the cookie token using a server-only secret into a 64-hex pseudonymous profile key. The key is a recommendation namespace only, not an authenticated person, account ID, or verified age claim.
- Explicit interested/not-interested/show-less feedback and a suppressed category can be stored under that key. Profile preferences expire after 180 days.
- Recommendation impressions, card selections, video likes/unlikes made while opted in, player starts, observed 25/50/75 progress milestones, actual `ended` completion events, and player errors can be stored. Event details are pruned after 30 days. No event implies satisfaction; page dwell and page visit are not playback.
- The only playback-duration inputs are real native media events or Bunny's documented iframe Player.js events (`play`, `timeupdate`, `ended`, `error`). Bunny event monitoring has not been verified against a live Bunny account in this environment.

Without a profile (a visitor who disabled personalization, or a request that
never passed through the public middleware), the application does not record
recommendation events or use recommendation history. It returns a diversified
public cold-start mix. Existing `video_likes` and aggregate `like_count` remain global community aggregates; they are not used to link a community visitor identity to an individual recommendation profile.

## Explicit controls and data effects

- **Personalization is on by default:** the opaque cookie is issued on the first public page view of a session and the server reads whatever feedback and playback events exist. A profile with no signals yet does not claim to know interests — the shelf is labelled "Discover videos" until real signals exist.
- **Turn off personalization:** there is no in-page control any more; the API action `disable` deletes events, feedback and preference rows and clears the cookie.
- **Interested / Not interested / Show less like this / Don't recommend this category:** updates feedback or suppression on the server. “Not interested” hard-suppresses the video; “show less” soft-demotes its category; category suppression hard-excludes that category. The page refreshes after a successful save.
- **Reset recommendations:** deletes the visitor's events and video feedback and clears selected/suppressed categories, while keeping consent enabled. This starts with a clean profile.
- **Pause and delete profile:** deletes events, feedback, and preference rows and clears the cookie. Browse continues in cold-start mode.
- **Natural expiration:** profile and preference expire at 180 days; events at 30 days. An expired profile is not read; the scheduled deletion job physically purges expired rows.

No full viewer-facing event-history export or view-history dashboard is provided. A reset/delete control is present and is the supported deletion path for a visitor's current browser profile. If the browser token is lost, the platform cannot associate a new browser profile with that old anonymous profile.

## Identifiers, boundaries, and retention

- Cookie token is random, opaque, and server-only. HMAC profile hash uses a dedicated `ANALYTICS_HASH_SECRET` when set; otherwise existing server-only Supabase secret fallback. Browser-supplied tokens, video IDs, event type/context, and correlation IDs are validated but never treated as identity or trusted server measurements.
- Recommendation profile hashes are cryptographically namespaced separately from comment profile hashes and are never sent to community/comment APIs or advertiser systems.
- RLS is enabled for all three recommendation tables; anon/authenticated direct access is revoked. Only server `service_role` routes can access them. Service-role credentials are never included in browser bundles.
- Writes repeat public eligibility checks and consent state inside security-definer functions. Eligibility is published + public + rights cleared + moderation approved + not reupload-required + usable playback identity. Request bodies are byte-bounded, Zod validated, origin checked when supplied, rate limited, and event writes are idempotent.
- API responses containing personalized information set `Cache-Control: private, no-store`; they are not placed in the public catalog cache.
- `recommendation_events` are retained 30 days; `recommendation_feedback` and `recommendation_preferences` 180 days/consent period. `.github/workflows/recommendation-retention.yml` calls `/api/cron/recommendation-retention` daily with `CRON_SECRET`; failed cleanup is a deployment incident, not silent continued collection. The SQL function `prune_recommendation_data()` can be manually run by the trusted server as an operator recovery step.
- The application does not collect raw IP, user-agent, referrer, location, orientation, health, religion, or other intimate traits for recommendations. Existing global abuse rate limiting may use a daily HMAC-derived ingress key; raw network address is not placed in recommendation rows.
- Product code does not send this data to advertisers, use it for ad selection, use browser fingerprinting, perform cross-site tracking, or create a new account system.

## Security and abuse limits

- Consent is a product permission, not proof of age or verified identity. The public age gate is a self-declaration that is not persisted to browser storage; it is not remote age assurance. Legal/compliance owners must validate age assurance and adult-content distribution obligations separately before launch.
- Recommendation events are client observations and can be spoofed by a determined client. Rate limits, strict schemas, idempotency keys, bounded event batches, and server-side eligibility reduce abuse; client analytics are not payment counters or a fraud-proof system. Do not use these raw events for monetary settlement or creator compensation.
- Staff/application logs never include video IDs, titles, viewer hashes, event bodies, or personal histories. Feed operational log lines contain only surface, algorithm version, candidate count, empty status, and latency; ingestion errors log a stage name without user context.
- HMAC secrets must be server-only, unique and backed up/rotated under existing incident procedures. Rotating the secret intentionally invalidates existing anonymous personalization and requires the visitor to opt in again.
- The daily GitHub Actions retention job requires repository Actions secrets `SITE_URL` and `CRON_SECRET`; failure to configure or run it means the retention promise cannot be guaranteed. Monitor the job result and HTTP 2xx success.

## Operational responsibilities

1. Before deployment, apply migration 24, verify table grants/RLS, and ensure `CRON_SECRET` plus `ANALYTICS_HASH_SECRET` are configured in the server environment and GitHub Actions secrets.
2. Verify the daily cleanup Action's schedule and run it manually once. Keep no sensitive request/response payloads in workflow logs.
3. Monitor only aggregate request volume, candidate counts, failures, empty feeds, and latency. Never build an administrator dashboard of individual viewing profiles or expose recommendations to advertisers.
4. Handle profile deletion failures as privacy incidents: investigate the route/cron status without writing hashes or video histories into ordinary logs, restore deletion, and document the incident under the organization's privacy process.
5. Reassess retention and legal/consent copy with privacy counsel before changing duration or adding signals. New signals require review and explicit documentation.

## Limitations

This implementation has no user accounts for viewers, identity verification, export capability, production traffic baseline, verified staging database, or live Bunny test credentials. Token loss makes old anonymous data inaccessible to the visitor, so the scheduled retention limit still applies. Privacy-copy and lawful adult age-assurance obligations need jurisdiction-specific review outside this code change.
