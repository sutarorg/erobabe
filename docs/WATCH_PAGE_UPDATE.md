# Fixed taxonomy and watch-page community update

> **Historical document (superseded 2026-10-27).** Video uploads and Bunny
> Stream are retired. This file is kept for provenance; read
> `docs/DAMPLIPS_EMBEDS.md` for the current catalog flow (damplips embeds,
> `npm run import:damplips`, `/api/videos/stream`).

Apply the pending migrations in order, including `00000000000021_fixed_categories_and_community.sql` and `00000000000022_unique_anonymous_comment_profiles.sql`, before deploying the matching application. No live database migration is performed by editing this repository.

- The fixed-category migration seeds the requested 12 categories, keeping IDs, thumbnails and existing descriptions for matching slugs. Retired categories are removed; their videos are **not deleted**, but become uncategorized and need admin reassignment. Upload recovery rows are preserved with a null category; unfinished Bunny sessions in retired categories are cancelled and must be restarted with a current category. Back up the database and review affected category assignments before applying.
- Category creation, deletion and identity/icon changes are blocked at the database level as well as through the admin API. Admins retain description and thumbnail editing.
- Homepage and watch-page Top Categories now share the same compact grid: five cards on mobile (four featured categories plus the final More card), with no horizontal scrolling. Desktop retains the full featured row.
- More like this uses the current category; Recommended uses public video popularity; Top Rated uses persisted anonymous likes (new installations start at zero, with newest videos breaking ties). All lists exclude the current video and require cleared, approved, public, published videos that do not need re-upload.
- Fixed video sections render up to four rows, with four columns when the center panel has enough room and two/three on smaller panels. Sparse catalogs are not padded with duplicate cards.
- Latest requests four rows per batch, uses a timestamp/ID cursor and IntersectionObserver, and stops at the end. A spinner replaces the visible loading message while new videos are fetched; a manual Load more/Retry button remains available.
- Comments display the first two newest comments and five more per click. On a visitor's first comment, the server asks OpenRouter for a funny username and appends a unique suffix; a database unique index prevents duplicate handles. The username is returned to and stored in localStorage with the browser ID. Existing pre-AI local handles are replaced on the next successful comment. Set the server-only `OPENROUTER_API_KEY` for first-time commenters. These names are pseudonyms, not authenticated identities.
- Comments are plain text (React escapes markup), limited to 1,000 characters, and rate-limited transactionally to one per 30 seconds per hashed request IP. Ensure the deployment proxy supplies a trusted `x-forwarded-for` header. The database stores only an HMAC of the rate key, never the raw IP. Anonymous likes are browser-based, not fraud-resistant account ratings.
- Community writes require `SUPABASE_SECRET_KEY` or the legacy `SUPABASE_SERVICE_ROLE_KEY`. Tables and RPCs are unavailable to direct anonymous/authenticated database clients. Operators can remove abusive comments through privileged database tools; a dedicated moderation UI is not included.
