/**
 * How many videos a public video shelf shows and how many it asks for.
 *
 * Shared by the server pages (request sizes) and the client grids (render
 * sizes) so the two can never drift: a mobile shelf always shows ten videos
 * vertically, and a wide panel fills up to four rows of four columns.
 *
 * Kept in `lib/` rather than in the hook module because server components need
 * these numbers too.
 */

/** Desktop video sections are four rows tall. */
export const GRID_ROWS = 4;

/** Mobile video sections show ten videos, one per row. */
export const MOBILE_GRID_ROWS = 10;

/** Four columns is the widest shelf; a five-column mode is never used. */
export const MAX_GRID_COLUMNS = 4;

/**
 * Videos a full-width shelf can show, and therefore the number every
 * recommendation/latest/featured request asks for.
 *
 * Asking for this many means a desktop shelf is never padded with a partial
 * row, while a phone still shows exactly `MOBILE_SHELF_LIMIT` of them.
 */
export const SHELF_VIDEO_LIMIT = MAX_GRID_COLUMNS * GRID_ROWS;

/** Videos a phone shows in one shelf. */
export const MOBILE_SHELF_LIMIT = MOBILE_GRID_ROWS;

/**
 * The watch page's Up Next shelf is decorative and only ever two columns wide,
 * so it shows (and reports impressions for) at most eight videos.
 */
export const UP_NEXT_VIDEO_LIMIT = 2 * GRID_ROWS;

/**
 * Latest feed batches cover two shelves per request and start loading when the
 * sentinel is still two screens away, so scrolling never waits on a request.
 */
export const LATEST_FEED_BATCH_ROWS = 2;

/** The feed route accepts at most 24 videos per request. */
export const LATEST_FEED_MAX_BATCH = 24;

/**
 * Never ask for fewer than two phone screens of videos.
 *
 * The first request is sent before the grid has been measured (the server
 * renders a two-column guess), so a phone would otherwise get a desktop-sized
 * batch and immediately need another request while scrolling.
 */
export const LATEST_FEED_MIN_BATCH = MOBILE_SHELF_LIMIT * LATEST_FEED_BATCH_ROWS;

/** Start fetching two screens before the sentinel becomes visible. */
export const LATEST_FEED_ROOT_MARGIN = "2400px 0px";

/**
 * Videos to request from `/api/videos/feed` for one Latest batch.
 *
 * Two shelves' worth of videos at the measured width, never fewer than two
 * mobile shelves (so a phone receives more than a screenful per request) and
 * never more than the route allows.
 */
export function latestFeedBatchSize(columns: number, rows: number): number {
  const width = Number.isFinite(columns) ? Math.max(1, Math.trunc(columns)) : 1;
  const height = Number.isFinite(rows) ? Math.max(1, Math.trunc(rows)) : GRID_ROWS;
  const perBatch = width * height * LATEST_FEED_BATCH_ROWS;
  return Math.min(LATEST_FEED_MAX_BATCH, Math.max(LATEST_FEED_MIN_BATCH, perBatch));
}
