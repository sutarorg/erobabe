# Advertising update — checkout wizard, admin deletion, mobile ad rotation

This document describes the advertising changes on this branch. It is a
changelog plus the operational details needed to deploy and verify them.

## 1. Guest checkout (`/checkout`)

The checkout is now a three-step wizard in the left panel, with a **fixed,
non-scrolling** payment panel on the right that replaces the old
“Order summary” QR block.

| Step | Contents |
| --- | --- |
| **1. Ads Details** | The ten fixed 16:9 placements drawn like the homepage ad cards: **two columns × five rows**. A sold placement shows its running creative and cannot be selected; an open one shows **Available** and selecting it advances the wizard. Duration is fixed at **1 month**. |
| **2. Advertiser details** | **Media upload** (required, JPG/PNG/GIF of any shape, max 5 MB; every upload opens a 16:9 crop picker showing the original picture with a draggable 16:9 window — even a 16:9 picture, because the subject may be off-centre — and a delete icon in the thumbnail corner removes it) → **Destination URL** (required, second field, highlighted) → Your name (required) → Company / brand (optional) → Email (required) → Ad name (required) → About you (optional). |
| **3. Payment** | Order summary (slot, 1 month, $99.00) and **Pay $99.00 with PayPal**. Paying writes the `in_review` order through `POST /api/ads/submit`, then hands the visitor to the hosted PayPal page. |

Payment page: `https://www.paypal.com/ncp/payment/AZP63KXT9FUNL`
(`lib/ads/payment.ts`).

### Returning from PayPal

PayPal sends the payer back to the website homepage. Just before leaving, the
checkout writes a short-lived flag (`erobabe:ad-review`) in `localStorage`; the
first public page load consumes it and shows the **In review** card:

* simple card: check mark, “In review”, one line “We’re verifying your PayPal
  payment.”, and a progress bar;
* animates in (`ad-review-in`), holds, animates out (`ad-review-out`);
* exactly **10 seconds**, then `router.replace("/")`;
* the flag is removed immediately, so reloading does not repeat it.
* `?ad_review=1|true|success` also triggers it, for PayPal return URLs that
  carry a query string.

`/checkout/review` no longer exists — the confirmation lives on the homepage.

### Layout and scrolling

On desktop the page itself does not scroll: the wizard is its own scroll area
(`lg:h-screen lg:overflow-y-auto`, class `.checkout-scroll`) with a thin,
theme-matching scrollbar on its right edge, while the artwork panel stays fixed
in the right column. Below `lg` the document scrolls normally and the artwork
panel follows the wizard.

`NEXT_PUBLIC_PAYMENT_PANEL_IMAGE_URL` (default:
`https://i.ibb.co/SXhzQ4ZQ/Untitled-Design-18-1.png`) is rendered in the fixed
panel, scaled to fit (`max-h-[82vh]`, `object-contain`) so it can never overflow
or scroll. The same artwork committed at
`public/Untitled Design (18) (1).png` is the bundled fallback if the hosted
image fails.

## 2. Admin panel

### Ad Review (`/admin/advertisements`)

* The banner column now stretches to the full card height and carries the
  placement, order value, live-until and submitted dates underneath the image —
  the blank area under the banner is gone.
* **Delete ad** (red) removes the advertisement permanently:
  * the banner file is removed from the `ad-creatives` bucket;
  * the `ad_orders` row is deleted, which frees the slot immediately;
  * the deletion is written to `audit_logs` (`action = 'ad_order_deleted'`,
    `level = 'warning'`, with the previous status, amount and
    `verified_cents`);
  * because the dashboard sums the orders that still exist, an ad deleted
    before its 30 days are over **no longer counts towards Verified Ad
    Revenue**, and the removed total is reported on the dashboard.
* Rejected submissions use the same action, labelled **Delete permanently**.
* Rejecting an ad already frees its slot (a rejected order never blocks a
  resale) — deleting it removes the record for good.

### Ad Slots (`/admin/ad-slots`)

Rebuilt as the homepage rails: the five left placements in the left column and
the right rail (five placements) plus the inventory summary card in the right
column — five cards left, six right. Sold placements show the live creative and
a green **Taken** tag with the end date; open placements show the “Advertise”
card with an **Available** tag and the price.

### Dashboard (`/admin`)

* **Ad Slots Overview** now reads real occupancy (the same resolver the
  checkout and the public rails use) and prints **Available** or **Taken** in
  green per slot.
* **Verified Ad Revenue** sums verified PayPal orders that still exist, so
  deleted advertisements are excluded; deletions are reported in the caption.

### Removed

* `/admin/campaigns` page, its navigation item and its API actions
  (`pause_campaign`, `resume_campaign`, `cancel_campaign`,
  `approve_creative`, `reject_creative`).
* `/admin/users` page, its navigation item and its API actions
  (`suspend_user`, `restore_user`). There are no advertiser accounts — staff
  are the only accounts, and `/api/admin/actions` now only handles report
  transitions. Migration 27 retires the same branches inside
  `admin_transition`.
* The advertiser portal rows/tables are untouched in the database for audit
  history; only the code paths are gone.

### System Health (`/admin/system-health`)

Rewritten to be resilient: no crash without Supabase credentials, real checks
for the database (`maybeSingle`, so an empty `site_settings` is not an error),
ad slot inventory, `ad-creatives` storage, the PayPal review queue, the
damplips catalog, Resend and OpenRouter, plus the retained-media inventory.

## 3. Mobile advertising

Below 1000px the desktop rails disappear, so the same ten creatives are reused
as in-flow 16:9 banners (hidden again from 1000px up with
`min-[1000px]:hidden`, so desktop layouts gain no empty grid cells).

| Surface | Placement |
| --- | --- |
| Home | one banner under **Recommended for you**, **Featured Videos** and **Latest Videos** (3 total) |
| Latest | one banner after every 8 videos, to the end of the infinite feed |
| Search results (`/?q=`) | one banner after every 8 results |
| Popular | one banner after every 8 videos |
| Watch page | one banner under **Comments**, **More like this**, **Recommended for you**, **Most Liked**, and one after every 8 videos of its **Latest** feed |
| Ad break | a separate mobile-only full-screen page on every third video: one centred 16:9 slot, a 3-second countdown, then the close button (top right) which returns to the selected video |

If no advertisement is active, every one of these renders the plain
“Advertise” card used on the homepage.

Every mobile placement — paid creative, vacant card and the ad break — also
prints a faded, underlined **“Advertise with us”** line underneath it that opens
`/checkout`. The ad-break page prints that line only: its three-second countdown
is shown as a small counter beside the close button, with no countdown caption
under the slot. The mobile card no longer carries the “Advertisement” tag in its
top-right corner; the “Ad” marker on paid creatives (top-left) stays.

### Rotation (`lib/ads/rotation.ts`)

* The pool is the active creatives (guest orders plus legacy campaigns).
* `orderedAds(pool, seed)` shuffles with a seeded PRNG; the seed is a stable
  per-browser token plus the UTC date, so visitors get different assignments
  and the order rotates daily.
* `adForPosition(pool, n)` cycles the shuffled pool: **n ads spread evenly**
  across the banners (each appears ⌊M/n⌋ or ⌈M/n⌉ times) and **one active ad
  fills every banner** — a banner is only empty when the pool itself is empty.
* The server renders a deterministic order and the browser re-shuffles after
  hydration, so there is no hydration mismatch.

## 4. Database

Apply `supabase/migrations/00000000000027_ad_cleanup_and_deletion.sql`:

* relaxes `ad_orders_contact_length` so the optional “About you” may be empty;
* adds a partial index for `ad_order_deleted` audit rows;
* replaces `admin_transition` with the report-only version (the advertiser and
  campaign operator actions are removed).

`00000000000025_paypal_ad_orders.sql` is still required for the order table and
the submit/review RPCs.

## 5. Verification

```bash
npm ci
npx tsc --noEmit        # clean
npx next lint --dir app --dir lib --dir src --dir tests
npx vitest run          # 71 files, 837 tests
npm run build
```

New/updated tests:

* `tests/unit/checkout.test.tsx` — wizard steps, media requirement, destination
  URL placement/highlight, PayPal hand-off, the review flag, the 10-second
  review card.
* `tests/unit/ad-rotation.test.ts` — even spread, single-ad fill, per-visitor
  difference, unusable creatives.
* `tests/unit/mobile-ads.test.tsx` — vacant fallback, single/multi ad banners,
  the every-third-video break with its countdown and redirect.
* `tests/unit/ad-inventory.test.ts` — Available/Taken occupancy for live,
  in-review, expired and campaign placements.
* `tests/unit/admin-ad-delete-route.test.ts` — permanent deletion, storage
  cleanup, audit metadata and revenue exclusion.
* `tests/e2e/portal-navigation.spec.ts` — no Users / legacy Campaigns entries.

### Not verifiable in this sandbox

The payment artwork is referenced from its host (`i.ibb.co`) because outbound
downloads are blocked in this environment. To make it self-hosted, save the
image into `public/` and set `NEXT_PUBLIC_PAYMENT_PANEL_IMAGE_URL` to that path;
the local copy in `public/` remains the bundled fallback.
