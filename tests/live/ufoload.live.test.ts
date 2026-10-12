import { readFile } from "node:fs/promises";
import { describe, it, expect, beforeAll } from "vitest";
import { UfoloadProvider, ufoloadApiKey, ufoloadApprovalFlag } from "@/lib/video/ufoload";
import { UFOLOAD_API_BASE, ufoloadEmbedUrl, describeUfoloadError } from "@/lib/video/ufoload-protocol";

/**
 * LIVE integration tests against the real UFOLOAD API.
 *
 * They are skipped unless `LIVE_UFOLOAD=1` is set, and they use whatever key is
 * in `UFOLOAD_API_KEY` — nothing here is mocked. Read `tests/live/README.md`
 * before running them: the upload test spends account quota and creates a file
 * (which it deletes again on success).
 *
 *   LIVE_UFOLOAD=1 UFOLOAD_API_KEY=ufo_... npm run test:live
 *
 * Optional:
 *   LIVE_UFOLOAD_FILE=/abs/path/small.mp4      exercise the direct chunked upload
 *   LIVE_UFOLOAD_IMPORT_URL=https://.../v.mp4  exercise the URL import
 *   LIVE_UFOLOAD_KEEP=1                        keep the created files (default: delete)
 *   LIVE_UFOLOAD_APPROVED=1                    skip the approval-gate assertion
 */

const enabled = process.env.LIVE_UFOLOAD === "1";
const videoPath = process.env.LIVE_UFOLOAD_FILE || "";
const importUrl = process.env.LIVE_UFOLOAD_IMPORT_URL || "";
const keepFiles = process.env.LIVE_UFOLOAD_KEEP === "1";

const describeLive = enabled ? describe : describe.skip;

/** Never let a key reach the output, even when a request fails. */
function safeMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const key = ufoloadApiKey();
  return key ? message.split(key).join("[redacted]") : message;
}

async function poll<T>(label: string, timeoutMs: number, attempt: () => Promise<T | null>): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: unknown = null;
  for (;;) {
    try {
      const result = await attempt();
      if (result) return result;
    } catch (error) {
      last = error;
    }
    if (Date.now() > deadline) {
      throw new Error(`${label} did not finish within ${Math.round(timeoutMs / 1000)}s${last ? `: ${safeMessage(last)}` : ""}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}

beforeAll(() => {
  if (!enabled) return;
  if (!ufoloadApiKey()) {
    throw new Error("LIVE_UFOLOAD=1 but UFOLOAD_API_KEY is not set — export the key from the server environment.");
  }
});

describeLive("UFOLOAD live API", () => {
  it("authenticates and reads the account's file list", async () => {
    const provider = new UfoloadProvider();
    // The approval flag gates *uploads*, not reads; assert its state explicitly
    // so a misconfigured environment is visible instead of surprising.
    if (!process.env.LIVE_UFOLOAD_APPROVED) {
      expect(provider.isEnabled()).toBe(true);
    }

    const files = await provider.listFiles({ limit: 1 });
    expect(Array.isArray(files)).toBe(true);
  });

  it("refuses to upload while the written approval is not recorded", async () => {
    if (process.env.LIVE_UFOLOAD_APPROVED) return; // explicitly waived by the operator
    const provider = new UfoloadProvider();
    const previous = process.env.UFOLOAD_ADULT_CONTENT_APPROVED;
    process.env.UFOLOAD_ADULT_CONTENT_APPROVED = "false";
    try {
      expect(ufoloadApprovalFlag()).toBe(false);
      expect(provider.isEnabled()).toBe(false);
      await expect(provider.initDirectUpload({ fileName: "gate.mp4", fileSize: 1024 })).rejects.toThrow(
        /UFOLOAD_ADULT_CONTENT_APPROVED/
      );
    } finally {
      if (previous === undefined) delete process.env.UFOLOAD_ADULT_CONTENT_APPROVED;
      else process.env.UFOLOAD_ADULT_CONTENT_APPROVED = previous;
    }
  });

  it.runIf(videoPath)("uploads a real file, waits for `ready`, and deletes it again", async () => {
    const provider = new UfoloadProvider();
    const bytes = await readFile(videoPath);
    const fileName = `live-check-${Date.now()}.mp4`;

    const grant = await provider.initDirectUpload({ fileName, fileSize: bytes.byteLength });
    expect(grant.url).toMatch(/^https:\/\//);
    expect(grant.authorization.length).toBeGreaterThan(0);
    // The API key must never be the credential for the node.
    expect(grant.authorization).not.toContain(ufoloadApiKey() || "impossible");

    let fileId: string | null = null;
    try {
      let offset = 0;
      while (offset < bytes.byteLength) {
        const length = Math.min(grant.chunkSize, bytes.byteLength - offset);
        const chunk = bytes.subarray(offset, offset + length);
        const response = await fetch(`${grant.url}?offset=${offset}`, {
          method: "PUT",
          headers: { Authorization: grant.authorization, "Content-Length": String(length) },
          body: chunk,
        });
        if (!response.ok) {
          const body = await response.text().catch(() => "");
          throw new Error(`Chunk PUT at ${offset} failed (${response.status}): ${body.slice(0, 200)}`);
        }
        offset += length;
      }

      const state = await provider.getUploadState(grant.uploadId);
      expect(["pending", "completing", "completed"]).toContain(state.state);

      const file = await provider.completeDirectUpload(grant.uploadId, { size: bytes.byteLength });
      fileId = file.id;
      expect(file.id).toBeTruthy();

      const ready = await poll("encoding", 12 * 60 * 1000, async () => {
        const current = await provider.getFile(file.id);
        if (current.status === "failed") throw new Error(current.error || "UFOLOAD reported the file as failed");
        return current.status === "ready" ? current : null;
      });

      expect(ready.status).toBe("ready");
      expect(ready.durationSeconds ?? 0).toBeGreaterThan(0);
      // The addresses we store are the stable embed/watch pages, not signed links.
      expect(provider.getEmbedUrl(ready.id)).toBe(ufoloadEmbedUrl(ready.id));
      expect(provider.getPlayableUrl(ready.id)).toBe(ufoloadEmbedUrl(ready.id).replace("/e/", "/v/"));
    } finally {
      if (fileId && !keepFiles) {
        await provider.deleteFile(fileId).catch((error) => {
          console.warn(`[live] cleanup could not delete ${fileId}: ${safeMessage(error)}`);
        });
      }
    }
  });

  it.runIf(importUrl)("imports a URL and waits for the created file", async () => {
    const provider = new UfoloadProvider();
    const started = await provider.createImport({ url: importUrl, name: `live-import-${Date.now()}` });
    expect(started.id).toBeTruthy();
    expect(started.fileId).toBeNull();

    let fileId: string | null = null;
    try {
      const done = await poll("import", 15 * 60 * 1000, async () => {
        const task = await provider.findImport(started.id);
        if (!task) return null;
        if (task.status === "failed" || task.status === "cancelled") {
          throw new Error(task.error || `UFOLOAD reported the import as ${task.status}`);
        }
        return task.status === "done" && task.fileId ? task : null;
      });
      fileId = done.fileId;

      const ready = await poll("import encoding", 12 * 60 * 1000, async () => {
        const current = await provider.getFile(done.fileId as string);
        if (current.status === "failed") throw new Error(current.error || "UFOLOAD reported the file as failed");
        return current.status === "ready" ? current : null;
      });

      expect(ready.id).toBe(done.fileId);
      expect(ready.status).toBe("ready");
    } finally {
      await provider.cancelImport(started.id).catch(() => false);
      if (fileId && !keepFiles) {
        await provider.deleteFile(fileId).catch((error) => {
          console.warn(`[live] cleanup could not delete ${fileId}: ${safeMessage(error)}`);
        });
      }
    }
  });

  it("reports an unauthenticated response as a configuration error, not a crash", async () => {
    const response = await fetch(`${UFOLOAD_API_BASE}/files/uploads`, {
      method: "POST",
      headers: { Authorization: "Bearer ufo_not_a_real_key", "Content-Type": "application/json" },
      body: JSON.stringify({ filename: "probe.mp4", size: 1024 }),
    });
    const payload = await response.json().catch(() => null);
    expect(response.status).toBeGreaterThanOrEqual(400);
    const described = describeUfoloadError(response.status, payload);
    // The message must tell the operator which variable to fix.
    expect(described.message).toMatch(/UFOLOAD_API_KEY|permission|key/i);
  });
});
