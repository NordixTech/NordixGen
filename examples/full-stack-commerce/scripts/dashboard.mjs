import { join } from "node:path";
import { expect as baseExpect } from "@playwright/test";
const expect = baseExpect.configure({ timeout: 15000 });

export async function verifyDashboard(browser, web, directory, adminState) {
  const context = await browser.newContext({ storageState: adminState });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && /hydrat|did not match/i.test(message.text()))
      errors.push(message.text());
  });
  try {
    for (const width of [280, 320, 390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(web);
      await expect(page.getByRole("heading", { name: "Make yourself at home." })).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      expect(await page.evaluate(() => document.fonts.check('22px "Caesar Dressing"'))).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await expect(
        page.locator(".ng-app-header").getByRole("link", { name: "AI Assistant" }),
      ).toHaveCount(0);
      if (width < 1024) {
        const toggle = page.getByRole("button", { name: "Open navigation" });
        await toggle.click();
        const drawer = page.getByRole("dialog", { name: "Navigation", exact: true });
        await expect(drawer).toBeVisible();
        // Native modal dialog contains keyboard focus, including backwards tabbing.
        for (let i = 0; i < 12; i++) {
          await page.keyboard.press(i % 2 ? "Shift+Tab" : "Tab");
          expect(await drawer.evaluate((element) => element.contains(document.activeElement))).toBe(
            true,
          );
        }
        await page.screenshot({ path: join(directory, `verified-navigation-${width}.png`) });
        await page.keyboard.press("Escape");
        await expect(drawer).not.toBeVisible();
        await expect(toggle).toBeFocused();
        await toggle.click();
        await drawer.getByRole("link", { name: "API Explorer", exact: true }).click();
        await expect(drawer).not.toBeVisible();
      } else {
        await expect(page.getByRole("button", { name: "Open navigation" })).not.toBeVisible();
        await page
          .getByRole("navigation", { name: "Main navigation", exact: true })
          .getByRole("link", { name: "API Explorer", exact: true })
          .click();
      }
      await expect(page).toHaveURL(`${web}/api-explorer`);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      // Permission reconciliation may replace the account menu once during navigation.
      await expect(async () => {
        if (new URL(page.url()).pathname === "/profile") return;
        const menu = page.locator(".ng-account-menu");
        await expect(menu.locator("summary")).not.toContainText("Checking session");
        if ((await menu.getAttribute("open")) === null) await menu.locator("summary").click();
        await menu.getByRole("link", { name: "My profile" }).click({ timeout: 2000 });
        await expect(page).toHaveURL(`${web}/profile`, { timeout: 2000 });
      }).toPass({ timeout: 15000 });
      await expect(page.getByRole("heading", { name: "Your profile", exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.goto(`${web}/admin/roles`);
      await page.getByRole("tab", { name: "Activity", exact: true }).click();
      await expect(page.getByRole("tabpanel", { name: "Activity", exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.goto(`${web}/audit`);
      await expect(page.getByRole("heading", { name: "Auditoría", exact: true })).toBeVisible();
      await expect(page.getByRole("region", { name: "Audit events", exact: true })).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Refresh activity", exact: true }),
      ).toBeEnabled();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({
        path: join(directory, `verified-audit-${width}.png`),
        fullPage: true,
      });
      await page.goto(web);
      await page.screenshot({
        path: join(directory, `verified-dashboard-${width}.png`),
        fullPage: true,
      });
    }
    await page.getByLabel("Account menu", { exact: true }).click();
    await page.keyboard.press("Escape");
    await expect(page.locator(".ng-account-menu")).not.toHaveAttribute("open", "");
    // Resizing a visible mobile drawer into desktop must release the modal and scroll lock.
    await page.setViewportSize({ width: 320, height: 900 });
    await page.getByRole("button", { name: "Open navigation" }).click();
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(page.getByRole("dialog", { name: "Navigation", exact: true })).not.toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
}
