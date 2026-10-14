# Current migration audit

See `docs/BUNNY_MIGRATION_AUDIT.md` for the pre-implementation file-by-file audit
against main commit 9aa06f8. Historical SQL files remain immutable; runtime uploads
are Bunny Stream only. Current deployment instructions are in `DEPLOYMENT.md`.

Scope intentionally excludes advertiser, payment, advertising and authentication
changes. Existing direct-media playback and manual/category/carousel thumbnail
management are retained. Retired hosted records are archived without media deletion;
untrusted generic iframes are no longer executable.
