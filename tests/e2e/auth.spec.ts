import { test, expect } from "@playwright/test";

test.describe("Authentication", () => {
  test("public sign-in is not offered", async ({ page }) => {
    const response = await page.goto("/auth/sign-in");
    expect(response?.status()).toBe(404);
    await page.goto("/");
    await expect(page.getByRole("link", { name: /sign in/i })).toHaveCount(0);
  });

  test("guest advertising checkout loads without signing in", async ({ page }) => {
    const response = await page.goto("/checkout?slot=1");
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: /Your brand, in the spotlight/i })).toBeVisible();
    await expect(page.getByAltText("Erobabe PayPal payment QR code")).toBeVisible();
    await expect(page).toHaveURL(/\/checkout\?slot=1/);
  });

  test("unauthenticated access to /admin redirects to sign-in", async ({
    page,
  }) => {
    await page.goto("/admin");
    // Staff have a separate sign-in route.
    await expect(page).toHaveURL(/\/admin\/signin/);
  });

  test("unauthenticated access to /advertiser is not a portal", async ({
    page,
  }) => {
    const response = await page.goto("/advertiser");
    expect(response?.status()).toBe(404);
  });
});
