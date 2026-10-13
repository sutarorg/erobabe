import { describe, it, expect, beforeAll } from "vitest";
import {
  loadThumbnailIndex,
  matchThumbnailFile,
  scanStreamtapeThumbnails,
  thumbnailFolderId,
  thumbnailFolderName,
} from "@/lib/video/streamtape-thumbnails";
import { getAccountInfo } from "@/lib/video/streamtape";

/**
 * LIVE Streamtape file-manager test — reads the real account with the real
 * credentials.
 *
 * It is excluded from `npm test` (see vitest.config.ts). Run it deliberately
 * from a machine with outbound HTTPS to api.streamtape.com:
 *
 *   STREAMTAPE_LOGIN=… STREAMTAPE_API_KEY=… npm run test:live
 *
 * This is the only check that proves the thumbnail folder can actually be read
 * and matched; the unit suite stubs the API. It is read-only: nothing is
 * uploaded, renamed, or deleted.
 *
 * The same check is available to admins at runtime: **Admin → Videos →
 * Streamtape thumbnails → “Check folder”** (`GET
 * /api/admin/videos/streamtape-thumbnails`).
 */

const login = String(process.env.STREAMTAPE_LOGIN || "").trim();
const key = String(process.env.STREAMTAPE_API_KEY || "").trim();
const suite = login && key ? describe : describe.skip;

suite("Streamtape file manager (live)", () => {
  beforeAll(() => {
    if (!login || !key) {
      throw new Error("Set STREAMTAPE_LOGIN and STREAMTAPE_API_KEY to run the live Streamtape tests");
    }
    console.log("[live-streamtape] folder:", thumbnailFolderId() || `(search: ${thumbnailFolderName()})`);
  });

  it("reaches the account with the configured credentials", async () => {
    const account = await getAccountInfo();
    console.log("[live-streamtape] account:", account);
    expect(account).not.toBeNull();
  }, 60_000);

  it("finds the thumbnails folder and lists the images in it", async () => {
    const { folder, files } = await loadThumbnailIndex();
    console.log("[live-streamtape] folder:", folder);
    console.log("[live-streamtape] files:", files.map((file) => file.name));

    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      expect(file.linkid).toBeTruthy();
      expect(file.name).toBeTruthy();
    }
  }, 120_000);

  it("matches a video title to an image in that folder", async () => {
    const { files } = await loadThumbnailIndex();
    const first = files[0];
    // The image name is the strongest possible match for a video of the same
    // name, so the matcher must find it — anything else is a matching bug.
    const match = matchThumbnailFile(files, {
      id: "live-1",
      slug: first.name.replace(/\.[a-z0-9]{1,5}$/i, ""),
      title: first.name.replace(/\.[a-z0-9]{1,5}$/i, ""),
      thumbnail_url: null,
    });

    console.log("[live-streamtape] match for", first.name, "->", match?.file.name, match?.score);
    expect(match?.file.linkid).toBe(first.linkid);
  }, 120_000);

  it("reports the dry run without writing anything", async () => {
    const summary = await scanStreamtapeThumbnails([
      { id: "live-1", slug: "live-video", title: "Live Video", thumbnail_url: null },
    ]);
    console.log("[live-streamtape] scan:", summary);
    expect(summary.configured).toBe(true);
    expect(summary.error).toBeUndefined();
  }, 120_000);
});
