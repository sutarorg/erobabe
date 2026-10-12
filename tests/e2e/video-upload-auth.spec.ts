import { test, expect } from "@playwright/test";

/**
 * The video upload API is admin-only. These checks hit the real Next.js routes
 * over HTTP with no session at all, so they prove the authorization layer
 * answers anonymous callers before anything reaches UFOLOAD. They use only the
 * `request` fixture — no browser is needed.
 */
test.describe("video upload API refuses anonymous callers", () => {
  const writes = [
    "/api/videos/ufoload-session",
    "/api/videos/upload",
    "/api/videos/upload-url",
    "/api/videos/reconcile",
    "/api/videos/embed",
    "/api/videos/storage-token",
  ];

  for (const path of writes) {
    test(`POST ${path} → 401`, async ({ request }) => {
      const response = await request.post(path, { data: {} });
      expect(response.status()).toBe(401);
      const text = await response.text();
      expect(text).not.toMatch(/ufo_[A-Za-z0-9]{6,}|Bearer /);
    });
  }

  for (const path of ["/api/videos/status?jobIds=x", "/api/videos/ufoload-session?jobId=x", "/api/videos/reconcile"]) {
    test(`GET ${path} → 401`, async ({ request }) => {
      expect((await request.get(path)).status()).toBe(401);
    });
  }

  test("DELETE /api/videos/ufoload-session → 401", async ({ request }) => {
    expect((await request.delete("/api/videos/ufoload-session?jobId=x")).status()).toBe(401);
  });

  test("the scheduler endpoint does not accept a guessed bearer token", async ({ request }) => {
    for (const token of ["", "changeme", "a-long-random-cron-secret-0123456789"]) {
      const response = await request.post("/api/videos/reconcile", { headers: { Authorization: `Bearer ${token}` }, data: {} });
      expect(response.status()).toBe(401);
    }
  });

  test("the retired Uqload routes are gone", async ({ request }) => {
    for (const path of ["/api/videos/uqload-session", "/api/videos/uqload-confirm"]) {
      expect((await request.post(path, { data: {} })).status()).toBe(404);
    }
  });

  test("the upload page itself redirects an anonymous visitor to sign-in", async ({ request }) => {
    const response = await request.get("/admin/videos/upload", { maxRedirects: 0 });
    expect([302, 303, 307, 308]).toContain(response.status());
    expect(response.headers()["location"] || "").toContain("/auth/sign-in");
  });
});
