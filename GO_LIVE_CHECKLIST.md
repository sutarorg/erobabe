# Erobabe go-live checklist

## FileKosh — mandatory gates

- [ ] Obtain verified confirmation/create/PUT contracts and content/use approval.
- [ ] Configure server-only key, accepted MIME types, size policy, upload hosts and headers.
- [ ] Apply migrations through `00000000000011_filekosh_uploads.sql` forward on staging.
- [ ] Test browser CORS from the deployed origin; prove video bytes go directly to storage.
- [ ] Enable contract/browser verification flags only with real evidence.
- [ ] Upload several authorized files; verify genuine progress, thumbnails, READY metadata and atomic persistence.
- [ ] Test partial failure, retry without duplicate rows, cancellation, reload recovery and orphan cleanup.
- [ ] Test returned embed play/pause/seek/fullscreen on desktop and mobile with the restrictive sandbox.
- [ ] Preserve legacy rows; unsupported retired providers must not call APIs.
- [ ] Remove retired-provider deployment secrets/infrastructure.

## Existing functionality

- [ ] Validate admin/advertiser authentication, profile roles and RLS.
- [ ] Verify public listings, categories, video pages, metadata and sitemaps against staging data.
- [ ] Validate NOWPayments API/IPN signature, idempotency, callback and a genuine authorized test payment.
- [ ] Validate campaign/creative approval, invoices, advertiser portal and email delivery.
- [ ] Verify backups, rollback, DNS, HTTPS and server-only secrets.
- [ ] Run tests, lint, type checks, production build and environment-dependent browser tests.

See DEPLOYMENT.md for detailed setup. Passing mocks/build is not live provider evidence.
