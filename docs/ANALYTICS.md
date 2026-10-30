# Analytics

The admin analytics area reports what the site actually measured. Nothing in it
is estimated, sampled or synthesised: every number in `/admin/analytics` comes
from a row that a visitor's browser, or the advertising runtime, wrote into
Postgres. When there is no data the page says so; when storage is not ready it
says that instead — it never falls back to a plausible-looking figure.

- **Collection** — `POST /api/analytics/collect` (pageviews, engagement) and
  `POST /api/track/ad` (impressions, clicks on booked orders).
- **Storage** — migration `supabase/migrations/00000000000028_analytics.sql`:
  `analytics_sessions`, `analytics_pageviews`, `ad_order_events` plus a set of
  aggregate functions.
- **Reading** — `lib/analytics/queries.ts` → `/admin/analytics` pages and
  `/api/admin/analytics/export`.

---

## 1. What is measured, and what is deliberately not

| Question | Answer in this build |
| --- | --- |
| Unique visitors | One salted hash per network + browser where two events happened in the same session window (30 min). No cookie, no fingerprint, no third-party script. |
| Pageviews | One row per tracked path per session (`analytics_pageviews`). |
| Sessions | A session ends after 30 minutes of inactivity (`analytics_sessions.window_at`). |
| Engagement | A session is *engaged* when it contains a second pageview or the visitor stayed ≥ 10 s. Bounce = exactly one pageview and < 10 s. |
| Referrers | Host + path of the referring document, reduced to a host for reporting. Same-site referrals are dropped. |
| Campaigns | `utm_source` / `utm_medium` / `utm_campaign`, truncated to 80 characters. |
| Devices, browsers, OS | Reduced from the User-Agent header server-side. |
| Geography | Country / region / city from the CDN's `x-vercel-ip-*` headers. No IP address is stored, and none is looked up from a third-party database. |
| Advertising | Impressions and clicks per booked order, recorded only while the order is live inside its paid window. |
| **Not measured** | Identified users, cross-site behaviour, scroll depth per element, video watch-time curves, revenue per visitor. Those need data this schema does not have, and inventing them would make the dashboard lie. |

### Privacy rules enforced in code

- The visitor key is `sha256(secret + ip + user-agent + day)`. The IP and the
  User-Agent never reach the database; the hash is rotated daily by the day
  component, and the secret is not the service key unless no dedicated secret is
  configured (`lib/analytics/visitor.ts`).
- `Do Not Track` and `Global Privacy Control` stop collection entirely
  (`src/components/analytics/AnalyticsBeacon.tsx`).
- Private surfaces are never recorded: `/admin`, `/api`, `/auth`, `/checkout`,
  `/_next`, `/monitoring` (`lib/analytics/path.ts`). Admin activity cannot pollute
  visitor counts.
- Automated clients are dropped before anything is written: crawlers, monitors,
  `curl`, `python-requests`, headless Chrome (`lib/analytics/user-agent.ts`).
- Retention: pageviews and sessions are pruned after 90 days, advertising events
  after 400 days, by `prune_analytics_events()` and the `analytics-retention`
  cron route.

---

## 2. Attribution windows and the numbers that follow from them

Two session rows can be written for the same person; a pageview belongs to one
session; an advertising event belongs to an order. That gives four distinct
counting units, and the dashboard names them so they are never confused:

- **Pageviews** — pageview rows. Two views of one page count twice.
- **Sessions** — session rows with at least one tracked pageview.
- **Unique visitors** — distinct visitor hashes inside the window.
- **Engaged seconds** — summed measured foreground time, capped at 30 minutes
  per session and 1.8 M ms per flush by the route's schema.

Ratios are computed in `lib/analytics/metrics.ts` and never stored:

```
pagesPerSession = pageviews / sessions
bounceRate      = bounces / sessions
engagementRate  = engagedSessions / sessions
ctr             = clicks / impressions
cpm             = bookedCents / impressions * 1000
ecpm            = revenueCents / impressions * 1000
fillRate        = slot-time occupied by a live order / slot-time available
                  (10 slots × the length of the window, unioned so overlaps
                  count once)
```

Previous-period comparisons use the **whole preceding window** of equal
duration, not a partial one: for `range=today` the baseline is the same hours of
yesterday, and for a 28-day range it is the 28 days before that. Comparisons are
suppressed (rather than shown as -100 %) when the baseline is zero.

### Revenue

Advertising revenue is recognised only for orders that are `payment_status =
'verified'` **and** not rejected. An order's revenue is prorated across the days
it actually overlapped the selected range:

```
revenueCents = amount_cents * overlapDays / orderDays
```

Deleted orders are excluded everywhere. Their refund is already visible in the
admin payments area through `audit_logs.action = 'ad_order_deleted'`, and the
dashboard's "Verified Ad Revenue" is untouched by this module — it was, and
stays, the authority on money received.

---

## 3. Routes

### Collection

| Route | Method | Notes |
| --- | --- | --- |
| `/api/analytics/collect` | `POST` | 150 requests/min per visitor. Body: `{ sessionId, path \| null, search?, previousPath?, previousEngagedMs?, referrer? }`. Answers `202 { recorded: true }`, or `202 { recorded: false, reason }` for bots and unmeasured paths. `no-store`. |
| `/api/track/ad` | `POST` | 60 requests/min. Body: `{ eventId, orderId, slotId (1–10), kind: "impression" \| "click" }`. The database function itself refuses an order that is not live and verified, so a forged event writes nothing. |

`path: null` is the unload flush: it records the time spent on the page being
left without adding a pageview.

### Reading

| Route | Purpose |
| --- | --- |
| `/admin/analytics` | Overview: KPI cards, traffic series, top pages, referrers, devices, countries, advertising snapshot. |
| `/admin/analytics/traffic` | Traffic: series, entry/exit pages, referrers and referrer paths, campaigns. |
| `/admin/analytics/audience` | Audience: devices, browsers, operating systems, countries, regions, cities. |
| `/admin/analytics/engagement` | Engagement: engagement rate, per-video starts/completions/completion rate, page habits. |
| `/admin/analytics/advertising` | Advertising: impressions, clicks, CTR, CPM, eCPM, fill rate, revenue, per-placement rows, per-order rows. |
| `/admin/analytics/advertising/[id]` | One order: its own delivery, revenue, creative and placement details. |
| `/admin/analytics/pages/[...path]` | One public path: pageviews, entries, exits, bounce rate, referrers, countries. |
| `/api/admin/analytics/export` | CSV. `section=overview\|traffic\|audience\|engagement\|advertising\|page\|ad`, plus the same range parameters. |

All reading routes sit inside `app/admin/(dashboard)/layout.tsx`, which requires
`role = 'admin'` **and** `status = 'active'` server-side before any query runs.
The export route re-checks with `requireActiveAdmin()` because it is an API route
outside that layout.

### Caching

Loaders are wrapped in `unstable_cache` for 60 seconds under the `analytics` tag.
The wrapper is optional: outside a Next runtime (unit tests, scripts) it falls
through to a direct query, and a cache miss never turns into an empty report.

---

## 4. States the UI shows

`lib/analytics/queries.ts` returns one of five statuses, and each renders a
distinct panel (`src/components/analytics/StatePanel.tsx`):

| Status | Meaning | What the operator sees |
| --- | --- | --- |
| `ok` | Data loaded. | The report, or an explicit empty state per panel. |
| `unconfigured` | No service-role client (env missing). | "Analytics storage is not configured". |
| `unavailable` | Tables or functions absent (migration 28 not applied). | "Analytics tables are missing", quoting the file to run. |
| `forbidden` | RLS/permission error. | "You do not have access to analytics". |
| `error` | Anything else. | A generic failure; the database message is not echoed to the browser. |

Empty is not the same as zero: a range with no pageviews shows "No traffic
recorded in this range" rather than a dashboard of zeros pretending to be
measurements.

---

## 5. What you must change on your side

1. **Apply migration 28.**
   `supabase/migrations/00000000000028_analytics.sql`. Until it is applied every
   analytics page shows the "tables are missing" state, and collection returns
   `503` (it does not error the visitor's page).
2. **Set `ANALYTICS_HASH_SECRET`.** Any long random string, e.g.
   `openssl rand -hex 32`. Without it the visitor hash falls back to the Supabase
   service key, which works but couples the hash to a credential you may rotate.
   Rotating the secret re-counts every visitor as new — expected, and the reason
   to set it before launch rather than after.
3. **Set `CRON_SECRET` and schedule retention.**
   ```
   # vercel.json
   { "crons": [{ "path": "/api/cron/analytics-retention", "schedule": "17 3 * * *" }] }
   ```
   Vercel sends `Authorization: Bearer $CRON_SECRET`; the route compares it with
   `timingSafeEqual`. Without the secret the route answers 503, never 200.
4. **Serve geo headers.** Geography comes from `x-vercel-ip-country`,
   `-country-region` and `-city`. On Vercel these are present automatically. On
   another host put the equivalent headers behind the same names (Cloudflare:
   `CF-IPCountry` → rewrite), otherwise every visitor is reported as
   "(not set)" — which is honest, but useless.
5. **Keep `SUPABASE_SECRET_KEY` (or `SUPABASE_SERVICE_ROLE_KEY`) server-side.**
   Collection needs it; it must never be exposed with a `NEXT_PUBLIC_` prefix.
6. **Nothing to install on the visitor's device.** There is no cookie banner to
   add: the beacon stores one session id in `sessionStorage`, sets no cookie and
   loads no third-party script. If your jurisdiction requires notice, mention
   that anonymous, aggregated usage statistics are collected.

### Verifying it works

1. Open the public site, visit two pages, wait 12 seconds, close the tab.
2. Check `select count(*) from analytics_pageviews;` — two rows, one session.
3. Open `/admin/analytics?range=today` — the visit appears within 60 s (the
   cache window), and "Visitors Today" on the dashboard agrees with it.
4. `curl -X POST https://<host>/api/analytics/collect -H 'content-type: application/json' -d '{"sessionId":"11111111-1111-4111-8111-111111111111","path":"/"}'`
   should answer `202 {"recorded":true}` from a browser-like client and
   `202 {"recorded":false,"reason":"automated"}` from `curl` — that difference is
   the bot filter doing its job.

---

## 6. Tests

| File | Covers |
| --- | --- |
| `tests/unit/analytics-schema.test.ts` | The migration's tables, functions and grants against a real Postgres (PGlite). |
| `tests/unit/analytics-range.test.ts` | Presets, custom ranges, clamping, bucket choice, labels. |
| `tests/unit/analytics-metrics.test.ts` | Ratio maths, proration, fill rate, formatting, sorting, CSV escaping. |
| `tests/unit/analytics-collection-context.test.ts` | User-Agent reduction, bot detection, path/referrer normalisation, geo headers, visitor hashing. |
| `tests/unit/analytics-collect-route.test.ts` | Collection: normalisation, bot drop, private-path drop, validation, rate limit, failure. |
| `tests/unit/analytics-ad-event-route.test.ts` | Ad events: validation, slot bounds, non-live orders, rate limit. |
| `tests/unit/analytics-queries.test.ts` | Loaders: window selection, status mapping, proration, cache fallback. |
| `tests/unit/analytics-export-route.test.ts` | Export: admin gate, CSV shape, formula neutralisation, range clamping. |
| `tests/unit/analytics-pages.test.tsx` | Pages: KPIs, drill-downs, empty/error/permission states, 404s. |
| `tests/unit/analytics-components.test.tsx` | Table sorting/pagination, charts, range picker, tabs, KPI deltas. |

`npm run test` runs all of them; `npm run test:e2e` covers the admin sign-in gate
in a browser.
