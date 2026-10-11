import { test, expect } from "@playwright/test";

test.describe("Authentication", () => {
  test("sign-in page loads", async ({ page }) => {
    await page.goto("/auth/sign-in");
    await expect(page.locator("h1")).toContainText(/sign in/i);
    await expect(page.getByRole("link", { name: /back to home/i })).toHaveAttribute("href", "/");
  });

  test("sign-up page loads", async ({ page }) => {
    await page.goto("/auth/sign-up");
    await expect(page.locator("h1")).toContainText(/create advertiser/i);
    await expect(page.getByRole("link", { name: /back to home/i })).toHaveAttribute("href", "/");
  });

  test("unauthenticated access to /admin redirects to sign-in", async ({ page }) => {
    await page.goto("/admin");
    // Middleware should redirect to sign-in
    await expect(page).toHaveURL(/\/auth\/sign-in/);
  });

  test("unauthenticated access to /advertiser redirects to sign-in", async ({ page }) => {
    await page.goto("/advertiser");
    await expect(page).toHaveURL(/\/auth\/sign-in/);
  });
});
