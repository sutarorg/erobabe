import { test, expect } from "@playwright/test";
import { build } from "esbuild";
let bundle: string;
test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `import React from 'react';import {createRoot} from 'react-dom/client';import AdminNav from './app/admin/(dashboard)/AdminNav';import PortalSidebar from './src/components/PortalSidebar';window.fixturePath='/admin/videos';const root=createRoot(document.getElementById('root'));window.draw=()=>root.render(<PortalSidebar portal="Admin" email="fixture@example.com"><AdminNav/></PortalSidebar>);window.draw();`,
      resolveDir: process.cwd(),
      loader: "tsx",
    },
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [
      {
        name: "isolated-navigation-adapter",
        setup(b) {
          b.onResolve({ filter: /^next\/(link|navigation)$/ }, (args) => ({
            path: args.path,
            namespace: "fixture",
          }));
          b.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
            loader: "jsx",
            resolveDir: process.cwd(),
            contents: args.path.endsWith("navigation")
              ? `export const usePathname=()=>window.fixturePath;`
              : `import React from 'react';export default function Link({href,prefetch,children,...props}){return <a href={href} {...props} onClick={e=>{e.preventDefault();window.fixturePath=href;history.pushState({},'',href);window.draw();}}>{children}</a>}`,
          }));
        },
      },
    ],
  });
  bundle = result.outputFiles[0].text;
});
test("production sidebar components: mobile drawer focus, groups, active route and close on navigation (isolated router fixture)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  // Only the router/auth boundary is substituted. Real component JS and application CSS.
  await page.route("**/__navigation_fixture", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<html><head></head><body><div id="root"></div></body></html>',
    }),
  );
  await page.goto("/__navigation_fixture");
  // Load the production design tokens/utility CSS emitted by the running Next app.
  const html = await (await page.request.get("/auth/sign-in")).text();
  for (const match of html.matchAll(/href="([^"]+\.css(?:\?[^"]*)?)"/g))
    await page.addStyleTag({ url: match[1] });
  await page.addScriptTag({ content: bundle });
  const open = page.getByRole("button", { name: "Open admin navigation" });
  await open.click();
  const dialog = page.getByRole("dialog", { name: "Admin menu" });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Content", exact: true }),
  ).toHaveAttribute("aria-expanded", "true");
  await expect(
    dialog.getByRole("link", { name: "Upload Videos", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await dialog
    .getByRole("button", { name: "Advertising", exact: true })
    .click();
  await dialog.getByRole("link", { name: "Ad Slots", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/ad-slots$/);
  await expect(dialog).not.toBeVisible();
  await open.click();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(open).toBeFocused();
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(open).not.toBeVisible();
  const desktop = page.locator("aside");
  await expect(desktop).toBeVisible();
  expect((await desktop.boundingBox())?.width).toBe(240);
  await desktop
    .getByRole("button", { name: "Management", exact: true })
    .click();
  await desktop.getByRole("link", { name: "Users", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/users$/);
});
test("all real portal destinations protect unauthenticated requests", async ({
  request,
}) => {
  for (const path of [
    "/admin",
    "/admin/videos",
    "/admin/categories",
    "/admin/ad-slots",
    "/admin/advertisements",
    "/admin/campaigns",
    "/admin/payments",
    "/admin/reports",
    "/admin/users",
    "/admin/logs",
    "/admin/system-health",
  ]) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status(), path).toBe(307);
    expect(response.headers().location, path).toContain(
      path.startsWith("/admin") ? "/admin/signin" : "/auth/sign-in",
    );
  }
});
