# Erobabe go-live checklist

## Bunny Stream — mandatory acceptance

- [ ] Review current AUP/ToS, obtain legal and account/content-use confirmation. No approval is assumed.
- [ ] Configure selected Video Library ID/API key, not account/CDN/Storage credentials.
- [ ] Back up DB; apply forward migrations through 12 on staging, then production. Keep historical migrations intact.
- [ ] Confirm archived hosted metadata is retained and requires authorized source re-upload.
- [ ] System Health reports successful read-only Bunny API connectivity, not merely configuration.
- [ ] Real browser Network shows video bytes go directly to Bunny TUS; Supabase receives only thumbnails/metadata.
- [ ] Batch authorized clips; validate real progress, 1280×720 best-frame JPEGs, status 4, atomic record/job creation.
- [ ] Verify short/long/blank intro/portrait/corrupt clips; failed thumbnails block publication and retry independently.
- [ ] Test pause/cancel, transient network retry, expired TUS resource, reload/reselection, DB failure and duplicate requests.
- [ ] Verify watch poster, cards/admin/SEO and Bunny controls on desktop/mobile using actual allowed production referrers.
- [ ] Standard encoding enabled; playback-token security settings compatible with unsigned validated embeds.
- [ ] Remove retired deployment secrets/jobs. Review orphans manually under an approved retention policy.
- [ ] Leave optional external vision ranking off unless both consent gates and provider/model approval are documented.

## Existing functionality

- [ ] Validate admin/advertiser authentication, profile roles and RLS.
- [ ] Verify public listings, categories, video pages, metadata and sitemaps against staging data.
- [ ] Validate NOWPayments API/IPN signature, idempotency, callback and a genuine authorized test payment.
- [ ] Validate campaign/creative approval, invoices, advertiser portal and email delivery.
- [ ] Verify backups, rollback, DNS, HTTPS and server-only secrets.
- [ ] Run type checks, unit tests, production build and browser tests.
- [ ] Clear hosting, age assurance, legal identity and provider-account production blockers.

See DEPLOYMENT.md for click-by-click setup. Passing mocks/build is not live provider evidence.
