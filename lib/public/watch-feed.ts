import "server-only";
import { latestRecommendations } from "@/lib/recommendations/service";
import type { PublicVideo } from "./catalog";

/** Latest is the only cursor-paginated feed in this module. Ranked surfaces use
 * score/id cursors through the shared recommendation service instead. */
export type FeedCursor = { date: string; id: string };
export async function watchFeed(mode: "latest", exclude: string, cursor?: FeedCursor, limit = 16) {
  const result = await latestRecommendations({ exclude, cursor, limit });
  return { videos: result.videos as PublicVideo[], cursor: result.cursor };
}
