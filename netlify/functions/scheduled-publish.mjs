import { publishDueVideos } from "../../server/scheduler.mjs";

/**
 * Netlify Scheduled Function — releases bulk-uploaded drafts whose
 * hourly slot has arrived. The cadence is set in netlify.toml.
 */
export const handler = async () => {
  try {
    const result = await publishDueVideos();
    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, ...result }),
    };
  } catch (e) {
    console.error("[erobabe scheduled-publish]", e);
    return { statusCode: 500, body: JSON.stringify({ ok: false }) };
  }
};
