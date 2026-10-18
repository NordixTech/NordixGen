import { join } from "node:path";
import { expect as baseExpect } from "@playwright/test";

const expect = baseExpect.configure({ timeout: 15_000 });
export async function verifyTheme(browser, page, web, directory, adminState) {
  const button = (theme) => page.getByRole("button", { name: `${theme} theme`, exact: true });
  const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await page.emulateMedia({ colorScheme: "light" });
  await expect(button("System")).toHaveAttribute("aria-pressed", "true");
  await expect.poll(background).toBe("rgb(248, 250, 252)");
  await button("Dark").focus();
  await page.keyboard.press("Enter");
  await expect(button("Dark")).toHaveAttribute("aria-pressed", "true");
  await expect.poll(background).toBe("rgb(11, 15, 25)");
  await page.reload();
  await expect(button("Dark")).toHaveAttribute("aria-pressed", "true");
  await expect.poll(background).toBe("rgb(11, 15, 25)");
  await page.screenshot({ path: join(directory, "verified-theme-dark.png"), fullPage: true });
  await button("Light").click();
  await expect.poll(background).toBe("rgb(248, 250, 252)");
  await page.screenshot({ path: join(directory, "verified-theme-light.png"), fullPage: true });
  await button("System").click();
  await page.emulateMedia({ colorScheme: "dark" });
  await expect.poll(background).toBe("rgb(11, 15, 25)");
  await page.emulateMedia({ colorScheme: "light" });
  await expect.poll(background).toBe("rgb(248, 250, 252)");
  const other = await page.context().newPage();
  try {
    await other.goto(web);
    await button("Dark").click();
    await expect(other.getByRole("button", { name: "Dark theme", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await other.evaluate(() => localStorage.removeItem("nordix-theme"));
    await expect(button("System")).toHaveAttribute("aria-pressed", "true");
  } finally {
    await other.close();
  }
  // Prove the stored dark preference applies without loading React or hydrating.
  const early = await browser.newContext({ colorScheme: "light" });
  try {
    await early.addInitScript(() => localStorage.setItem("nordix-theme", "dark"));
    const beforeHydration = await early.newPage();
    await beforeHydration.route("**/_next/**/*.js*", (route) => route.abort());
    await beforeHydration.goto(web, { waitUntil: "domcontentloaded" });
    await expect(beforeHydration.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect
      .poll(() => beforeHydration.evaluate(() => getComputedStyle(document.body).backgroundColor))
      .toBe("rgb(11, 15, 25)");
  } finally {
    await early.close();
  }
  const blocked = await browser.newContext({ colorScheme: "light" });
  try {
    await blocked.addInitScript(() =>
      Object.defineProperty(window, "localStorage", {
        get() {
          throw new DOMException("Blocked", "SecurityError");
        },
      }),
    );
    const fallback = await blocked.newPage();
    const errors = [];
    fallback.on("pageerror", (error) => errors.push(error.message));
    await fallback.goto(web);
    await fallback.getByRole("button", { name: "Dark theme", exact: true }).click();
    await expect(fallback.locator("html")).toHaveAttribute("data-theme", "dark");
    expect(errors).toEqual([]);
  } finally {
    await blocked.close();
  }
  const screens = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const screen = await screens.newPage();
  try {
    const errors = [];
    screen.on("pageerror", (error) => errors.push(error.message));
    screen.on("console", (message) => {
      if (message.type() === "error" && /hydrat|did not match/i.test(message.text()))
        errors.push(message.text());
    });
    await screen.goto(`${web}/sign-in`);
    await screen.getByRole("button", { name: "Dark theme", exact: true }).click();
    await expect(screen.locator("html")).toHaveAttribute("data-theme", "dark");
    await screen.screenshot({
      path: join(directory, "verified-theme-auth-dark.png"),
      fullPage: true,
    });
    await screens.addCookies(adminState.cookies);
    await screen.goto(`${web}/customer`);
    await expect(screen.getByRole("status", { name: /role admin/ })).toBeVisible();
    await expect(screen.getByRole("table")).toBeVisible();
    // Account reconciliation can replace the account-scoped subtree once after navigation.
    // Opening a dialog is reversible; retry if that transition disposes the first click.
    await expect(async () => {
      await screen.getByRole("button", { name: "+ New Customer", exact: true }).click();
      await expect(screen.getByRole("dialog")).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 15000 });
    await expect(screen.getByRole("dialog")).toHaveCSS("background-color", "rgb(17, 24, 39)");
    await screen.screenshot({
      path: join(directory, "verified-theme-form-dark.png"),
      fullPage: true,
    });
    await screen.getByRole("button", { name: "Close dialog", exact: true }).click();
    await screen.goto(`${web}/api-explorer`);
    await screen
      .getByRole("combobox", { name: "Select API operation" })
      .selectOption("listInvoices");
    await screen.getByRole("button", { name: "Send request", exact: true }).click();
    await expect(screen.locator(".ng-json-output")).toBeVisible();
    await expect(screen.locator(".ng-panel").first()).toHaveCSS(
      "background-color",
      "rgb(17, 24, 39)",
    );
    await screen.screenshot({
      path: join(directory, "verified-theme-explorer-dark.png"),
      fullPage: true,
    });
    await screen.goto(`${web}/admin/roles`);
    await expect(screen.getByRole("heading", { name: "Access administration" })).toBeVisible();
    await expect(screen.getByRole("button", { name: "Create role", exact: true })).toBeEnabled();
    await expect(screen.locator(".ng-iam-card").first()).toHaveCSS(
      "background-color",
      "rgb(17, 24, 39)",
    );
    await screen.screenshot({
      path: join(directory, "verified-theme-iam-dark.png"),
      fullPage: true,
    });
    await screen.getByRole("button", { name: "Create role", exact: true }).click();
    await expect(screen.getByRole("dialog")).toHaveCSS("background-color", "rgb(17, 24, 39)");
    await screen.screenshot({ path: join(directory, "verified-theme-iam-editor-dark.png") });
    await screen.setViewportSize({ width: 390, height: 844 });
    expect(await screen.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await screen.screenshot({
      path: join(directory, "verified-theme-iam-mobile-dark.png"),
    });
    expect(errors).toEqual([]);
  } catch (error) {
    await screen
      .screenshot({ path: join(directory, "failure-theme-screen.png"), fullPage: true })
      .catch(() => {});
    throw error;
  } finally {
    await screens.close();
  }
}
