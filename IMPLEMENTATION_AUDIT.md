# Current migration audit

> **Historical document (superseded 2026-10-27).** Video uploads and Bunny
> Stream are retired. This file is kept for provenance; read
> `docs/DAMPLIPS_EMBEDS.md` for the current catalog flow (damplips embeds,
> `npm run import:damplips`, `/api/videos/stream`).

See `docs/BUNNY_MIGRATION_AUDIT.md` for the pre-implementation file-by-file audit
against main commit 9aa06f8. Historical SQL files remain immutable; runtime uploads
are Bunny Stream only. Current deployment instructions are in `DEPLOYMENT.md`.

Scope intentionally excludes advertiser, payment, advertising and authentication
changes. Existing direct-media playback and manual/category/carousel thumbnail
management are retained. Retired hosted records are archived without media deletion;
untrusted generic iframes are no longer executable.
