import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect } from "@playwright/test";

/**
 * GATED real-browser acceptance flow: admin upload → Streamtape conversion →
 * Gemini metadata (source 'ai') → publish → public playback.
 *
 * Runs ONLY with LIVE_E2E_STREAMTAPE=1 against a STAGING deployment that has
 * real Streamtape + Gemini + Supabase configuration. It uploads and publishes
 * one synthetic test video and never deletes or edits any existing video.
 *
 *   LIVE_E2E_STREAMTAPE=1 \
 *   PLAYWRIGHT_BASE_URL=https://staging.example.com \
 *   E2E_ADMIN_EMAIL=... E2E_ADMIN_PASSWORD=... \
 *   [E2E_CATEGORY_LABEL="Mature"] [E2E_VIDEO_FILE=/abs/path/small.mp4] \
 *   npx playwright test streamtape-upload.acceptance
 *
 * Evidence: screenshots + trace + video are attached to the test report
 * (playwright-report/, test-results/), and the created slug / provider id are
 * printed at the end. Never point this at production.
 */

const enabled = process.env.LIVE_E2E_STREAMTAPE === "1";
const baseURL = process.env.PLAYWRIGHT_BASE_URL || "";

// Evidence artifacts for this spec only (must be top-level, not inside describe).
test.use({ trace: "on", screenshot: "on", video: "on" });

test.describe("Streamtape upload → publish → playback (live, staging)", () => {
  test.skip(!enabled, "Set LIVE_E2E_STREAMTAPE=1 (and staging credentials) to run the live acceptance flow.");
  test.setTimeout(25 * 60 * 1000);

  test("admin uploads a real video and it plays on the public page", async ({ page }, testInfo) => {
    expect(baseURL, "PLAYWRIGHT_BASE_URL must point at the staging site").toMatch(/^https:\/\//);
    expect(baseURL, "refusing to run against the production hostname").not.toMatch(/^https:\/\/(www\.)?erobabe\.com/);
    const email = process.env.E2E_ADMIN_EMAIL || "";
    const password = process.env.E2E_ADMIN_PASSWORD || "";
    expect(email && password, "E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD are required").toBeTruthy();

    // ---- fixture: short, non-explicit synthetic test pattern -------------------
    let videoPath = process.env.E2E_VIDEO_FILE || "";
    if (!videoPath) {
      videoPath = join(tmpdir(), `erobabe-e2e-${Date.now()}.mp4`);
      execFileSync("ffmpeg", ["-y", "-f", "lavfi", "-i", "testsrc=duration=4:size=640x360:rate=24", "-f", "lavfi", "-i", "sine=frequency=440:duration=4", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", videoPath], { stdio: "ignore" });
    }

    // ---- sign in ---------------------------------------------------------------
    await page.goto("/auth/sign-in");
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).first().fill(password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/admin|\/advertiser|\//, { timeout: 30_000 });

    // ---- System Health must not claim a healthy provider from a flag alone -----
    await page.goto("/admin/system-health");
    const providerCard = page.locator("div", { hasText: "Video Provider" }).first();
    await expect(providerCard).toContainText(/streamtape/i);
    await page.screenshot({ path: testInfo.outputPath("01-system-health.png"), fullPage: true });
    await expect(providerCard).toContainText(/API reachable/i);

    // ---- open the REAL upload page --------------------------------------------
    await page.goto("/admin/videos/upload");
    await expect(page.getByText("Publish videos")).toBeVisible();
    const category = process.env.E2E_CATEGORY_LABEL;
    const select = page.getByLabel("Category *");
    await expect(select.locator("option")).not.toHaveCount(1);
    if (category) await select.selectOption({ label: category });
    else await select.selectOption({ index: 1 });

    await page.locator('input[type="file"][accept="video/*"]').setInputFiles(videoPath);

    // ---- observe the real byte transfer to the relay ---------------------------
    const relayRequest = page.waitForRequest((request) => request.method() === "POST" && /\/upload\/v1\./.test(request.url()), { timeout: 60_000 });
    const relayResponse = page.waitForResponse((response) => response.request().method() === "POST" && /\/upload\/v1\./.test(response.url()), { timeout: 10 * 60_000 });
    const uploadComplete = page.waitForResponse((response) => response.url().includes("/api/videos/upload") && response.request().method() === "POST", { timeout: 15 * 60_000 });

    await page.getByRole("button", { name: /Generate AI metadata & publish/ }).click();

    const sent = await relayRequest;
    expect(new URL(sent.url()).origin, "bytes must go to the relay, not to Next.js").not.toBe(new URL(baseURL).origin);
    const relayReply = await relayResponse;
    expect(relayReply.status(), "relay/node upload must succeed and be readable cross-origin").toBeLessThan(300);
    await page.screenshot({ path: testInfo.outputPath("02-uploaded.png"), fullPage: true });

    // ---- server completion: Gemini must have produced real AI metadata ---------
    const completion = await uploadComplete;
    expect(completion.status()).toBe(200);
    const result = await completion.json();
    expect(result.metadataSource, "Gemini must return valid source='ai' metadata, not the file-name fallback").toBe("ai");
    expect(result.providerFileId, "a confirmed Streamtape file id").toMatch(/^[A-Za-z0-9_-]{6,64}$/);
    const fileId: string = result.providerFileId;
    const slug: string = result.video.slug;

    // ---- wait for REAL conversion, then publication ----------------------------
    await expect(page.getByText("Published · Streamtape has the video ready to play")).toBeVisible({ timeout: 20 * 60_000 });
    await page.screenshot({ path: testInfo.outputPath("03-published.png"), fullPage: true });

    // ---- reload the saved record through the authenticated status API ----------
    const status = await page.request.get(`/api/videos/status?videoId=${encodeURIComponent(result.videoId)}`);
    expect(status.ok()).toBeTruthy();
    const saved = (await status.json()).video;
    expect(saved).toMatchObject({
      provider: "streamtape",
      provider_file_id: fileId,
      embed_url: `https://streamtape.com/e/${fileId}`,
      status: "published",
      visibility: "public",
      rights_status: "cleared",
      moderation_status: "approved",
    });
    expect(saved.title).toBe(result.metadata.title);
    expect(saved.description).toBe(result.metadata.description);

    // ---- public page in a fresh, signed-out context ----------------------------
    const publicContext = await page.context().browser()!.newContext({ baseURL });
    const publicPage = await publicContext.newPage();
    // The age gate stores consent in localStorage; set it like a returning visitor.
    await publicPage.addInitScript(() => {
      try {
        window.localStorage.setItem("erobabe-age-verified", new Date().toISOString());
      } catch {}
    });
    const frameResponse = publicPage.waitForResponse((response) => response.url().startsWith(`https://streamtape.com/e/${fileId}`), { timeout: 60_000 });
    await publicPage.goto(`/video/${slug}`);
    await expect(publicPage.getByRole("heading", { level: 1 })).toContainText(result.metadata.title);

    const iframe = publicPage.locator(`iframe[src="https://streamtape.com/e/${fileId}"]`);
    await expect(iframe, "the public page must embed the exact Streamtape player").toBeVisible();
    const playerResponse = await frameResponse;
    expect(playerResponse.status(), "the Streamtape player frame must load").toBe(200);
    await publicPage.screenshot({ path: testInfo.outputPath("04-public-page.png"), fullPage: true });

    // Best-effort play: the player is cross-origin; success = it renders a <video> or a play control.
    const player = publicPage.frameLocator(`iframe[src="https://streamtape.com/e/${fileId}"]`);
    const playable = player.locator("video, .plyr, .play-overlay, #mainvideo, button");
    await expect(playable.first()).toBeAttached({ timeout: 30_000 });
    await publicPage.screenshot({ path: testInfo.outputPath("05-player-frame.png"), fullPage: true });

    // Sitemap must list the now-eligible video.
    const sitemap = await publicPage.request.get("/video-sitemap.xml");
    expect(sitemap.ok()).toBeTruthy();
    expect(await sitemap.text()).toContain(`/video/${slug}`);

    await publicContext.close();

    // Report — the operator decides whether to keep or remove this staging test video.
    console.log(`[streamtape-acceptance] slug=${slug} providerFileId=${fileId} publicUrl=${baseURL}/video/${slug}`);
    testInfo.annotations.push({ type: "slug", description: slug }, { type: "providerFileId", description: fileId });
  });
});
