import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect as baseExpect, chromium, request } from "@playwright/test";
import { verifyDashboard } from "./dashboard.mjs";
import { verifyTheme } from "./theme.mjs";

const expect = baseExpect.configure({ timeout: 15_000 });
const password = "acceptance-local-password-2026";
const missing = "00000000-0000-4000-8000-000000000000";
export async function verifyApplication(state, directory, expireAccountant) {
  const api = `http://localhost:${state.apiPort}`;
  const web = `http://localhost:${state.webPort}`;
  const browserApi = `${web}/api/backend/api`;
  const persistence = JSON.parse(
    await readFile(join(state.output, "apps/api/acceptance-persistence.json"), "utf8"),
  );
  const contexts = [];
  const behaviors = [];
  let browser;
  let page;
  const passed = async (name) => {
    behaviors.push(name);
    console.log(`  Verified: ${name}`);
    await writeFile(join(directory, "behaviors.json"), JSON.stringify(behaviors, null, 2));
  };
  const session = async (role) => {
    const client = await request.newContext({ baseURL: api, extraHTTPHeaders: { origin: web } });
    contexts.push(client);
    const login = await client.post("/api/auth/sign-in/email", {
      data: { email: `${role}@acceptance.example.test`, password },
    });
    expect(login.status(), `Sign in ${role}`).toBe(200);
    const cookies = (await client.storageState()).cookies;
    expect(cookies.some((cookie) => cookie.name.includes("session_token") && cookie.httpOnly)).toBe(
      true,
    );
    return client;
  };
  try {
    const anonymous = await request.newContext({ baseURL: api });
    contexts.push(anonymous);
    const admin = await session("admin");
    const viewer = await session("viewer");
    const accountant = await session("accountant");
    const outsider = await session("outsider");
    await passed("Real credential sessions use HttpOnly cookies for all configured roles");
    const publicResponse = await anonymous.get("/api/customers");
    expect(publicResponse.status()).toBe(200);
    const publicPage = await publicResponse.json();
    expect(publicPage.total).toBe(5);
    expect(publicPage.items.some((row) => row.joins.CustomerAddress.length > 0)).toBe(true);
    expect((await anonymous.get("/api/invoices")).status()).toBe(401);
    expect((await outsider.get("/api/invoices")).status()).toBe(403);
    expect((await viewer.get("/api/invoices")).status()).toBe(200);
    expect(
      (
        await viewer.post("/api/customers", {
          data: { name: "Denied", email: "denied@example.test" },
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await admin.post("/api/customers", {
          headers: { origin: "https://untrusted.example.test" },
          data: { name: "Denied", email: "denied@example.test" },
        })
      ).status(),
    ).toBe(403);
    await passed(
      "Public exception, missing identity 401, insufficient permissions 403 and trusted-origin enforcement",
    );

    for (const client of [anonymous, admin]) {
      expect((await client.get("/api/customer-addresses")).status()).toBe(404);
      expect((await client.get("/api/CustomerAddress")).status()).toBe(404);
      expect((await client.delete(`/api/invoices/${missing}`)).status()).toBe(404);
    }
    await passed(
      "Undeclared entity routes and Invoice delete are absent even for authenticated callers",
    );
    expect(
      (
        await admin.post("/api/customers", { data: { name: "", email: "bad@example.test" } })
      ).status(),
    ).toBe(400);
    expect((await admin.get("/api/customers/not-a-uuid")).status()).toBe(400);
    expect((await admin.get("/api/customers?invented=true")).status()).toBe(400);
    expect((await admin.get("/api/invoices?pageSize=999")).status()).toBe(400);
    const created = await admin.post("/api/customers", {
      data: { name: "API acceptance customer", email: `api-${state.id}@example.test` },
    });
    expect(created.status()).toBe(200);
    const customer = (await created.json())[0].entity;
    expect(customer.state).toBe("active");
    expect(customer.deletedAt).toBeNull();
    expect(customer.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const updated = await admin.patch(`/api/customers/${customer.id}`, {
      data: { name: "Updated API customer" },
    });
    expect(updated.status()).toBe(200);
    expect((await updated.json())[0].entity.name).toBe("Updated API customer");
    const filtered = await admin.get("/api/customers?search=Updated%20API&page=1&pageSize=1");
    const filteredPage = await filtered.json();
    expect(filteredPage.total).toBe(1);
    expect(filteredPage.items[0].entity.id).toBe(customer.id);
    expect(filteredPage.pageSize).toBe(1);
    const nextPage = await admin.get("/api/customers?search=Updated%20API&page=2&pageSize=1");
    expect((await nextPage.json()).items).toHaveLength(0);
    await passed(
      "Declared customer create/update and paginated filtering honor validation, defaults and ISO transport dates",
    );

    const preview = `/__acceptance/preview-customer?customerId=${customer.id}`;
    expect((await anonymous.get(preview)).status()).toBe(401);
    expect((await outsider.get(preview)).status()).toBe(403);
    expect((await accountant.get(preview)).status()).toBe(403);
    const called = await viewer.get(preview);
    expect(called.status()).toBe(200);
    expect(await called.json()).toEqual({ ok: true, value: { customer: "Updated API customer" } });
    expect(
      (await viewer.get(`/__acceptance/preview-customer?customerId=${missing}`)).status(),
    ).toBe(404);
    expect((await viewer.get("/__acceptance/preview-customer?customerId=invalid")).status()).toBe(
      400,
    );
    const probes = await (
      await admin.get(`/__acceptance/context-probes?customerId=${customer.id}`)
    ).json();
    expect(probes.forged.error.code).toBe("unauthorized");
    expect(probes.revoked.error.code).toBe("unauthorized");
    await passed(
      "Authored billing workflow uses generated public wiring; callee denial, not_found, validation and forged/revoked contexts propagate",
    );
    expect((await admin.delete(`/api/customers/${customer.id}`)).status()).toBe(200);
    expect(await (await admin.get(`/api/customers/${customer.id}`)).json()).toEqual([]);
    expect((await (await admin.get("/api/customers?search=Updated%20API")).json()).total).toBe(0);
    await passed(
      "Declared customer delete applies the supported soft-delete policy and hides archived records",
    );

    const invoiceCreated = await admin.post("/api/invoices", {
      data: { customerId: persistence.customerId },
    });
    expect(invoiceCreated.status()).toBe(200);
    const invoice = (await invoiceCreated.json())[0].entity;
    expect(invoice).toMatchObject({
      total: 12.5,
      note: null,
      discount: null,
      payload: { currency: "USD" },
      enabled: true,
    });
    expect(invoice.issuedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(
      (
        await admin.patch(`/api/invoices/${invoice.id}`, {
          data: { total: 3.25, payload: "scalar JSON", discount: null },
        })
      ).status(),
    ).toBe(200);
    expect(
      (await admin.patch(`/api/invoices/${invoice.id}`, { data: { payload: null } })).status(),
    ).toBe(400);
    const invoices = await (await admin.get("/api/invoices?minimum=3&pageSize=20")).json();
    const changed = invoices.items.find((row) => row.entity.id === invoice.id).entity;
    expect(changed.total).toBe(3.25);
    expect(changed.payload).toBe("scalar JSON");
    expect(changed.discount).toBeNull();
    expect(changed.issuedAt).toBe(invoice.issuedAt);
    await passed(
      "Real invoice persistence preserves decimals, JSON scalars, nullability, clock defaults and untouched update fields",
    );

    browser = await chromium.launch();
    const browserContext = await browser.newContext({
      viewport: { width: 1400, height: 1000 },
      timezoneId: "America/Lima",
    });
    const browserOrigins = new Set();
    browserContext.on("request", (outgoing) => browserOrigins.add(new URL(outgoing.url()).origin));
    page = await browserContext.newPage();
    page.setDefaultTimeout(15_000);
    const browserErrors = [];
    page.on("pageerror", (error) => browserErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error" && /hydrat|did not match/i.test(message.text()))
        browserErrors.push(message.text());
    });
    const noPageOverflow = async () =>
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
    await page.goto(web);
    await verifyTheme(browser, page, web, directory, await admin.storageState());
    await verifyDashboard(browser, web, directory, await admin.storageState());
    await passed(
      "Dashboard, profile, font and keyboard navigation work from 280px to 1440px without overflow",
    );
    await passed(
      "Light/dark/system themes, keyboard selection, persistence, live system changes, cross-tab sync, blocked storage and pre-hydration dark initialization",
    );
    const directoryLinks = page
      .getByRole("navigation", { name: "Main navigation", exact: true })
      .locator(".ng-nav-group")
      .filter({ has: page.getByText("Application", { exact: true }) });
    await expect(directoryLinks.getByRole("link")).toHaveCount(2);
    await expect(directoryLinks.getByRole("link", { name: /Customer/ })).toHaveAttribute(
      "href",
      "/customer",
    );
    await expect(directoryLinks.getByRole("link", { name: /Invoice/ })).toHaveAttribute(
      "href",
      "/invoice",
    );
    await expect(page.getByRole("link", { name: "View project details" })).toHaveCount(0);
    await expect(page.getByText("Next.js App Router", { exact: true })).toHaveCount(0);
    await noPageOverflow();
    await page.screenshot({
      path: join(directory, "verified-workspace-desktop.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await noPageOverflow();
    await page.screenshot({
      path: join(directory, "verified-workspace-mobile.png"),
      fullPage: true,
    });
    await page.getByRole("button", { name: "Open navigation" }).click();
    await page
      .getByRole("dialog", { name: "Navigation", exact: true })
      .getByRole("link", { name: "Customer", exact: true })
      .click();
    await expect(page).toHaveURL(`${web}/customer`);
    await page.goto(web);
    await page.getByRole("button", { name: "Open navigation" }).click();
    await page
      .getByRole("dialog", { name: "Navigation", exact: true })
      .getByRole("link", { name: "Invoice", exact: true })
      .click();
    await expect(page).toHaveURL(`${web}/sign-in`);
    await page.setViewportSize({ width: 1400, height: 1000 });
    await passed(
      "Workspace links reach generated public/private pages on desktop and mobile without horizontal overflow",
    );
    await page.goto(`${web}/customer`);
    await expect(page).toHaveURL(`${web}/customer`);
    await expect(page.getByRole("table")).toBeVisible();
    await expect(page.getByRole("button", { name: "+ New Customer", exact: true })).toHaveCount(0);
    const sessionCookie = (await admin.storageState()).cookies.find((cookie) =>
      cookie.name.includes("session_token"),
    );
    assert.ok(sessionCookie);
    await browserContext.addCookies([{ ...sessionCookie, value: "fabricated-session.signature" }]);
    await page.goto(`${web}/invoice`);
    await expect(page).toHaveURL(`${web}/sign-in`);
    await browserContext.clearCookies();
    await passed(
      "Direct private pages reject absent/forged cookies without redirect loops; public pages remain public",
    );

    const signIn = async (role) => {
      await page.goto(`${web}/sign-in`);
      await page
        .getByRole("textbox", { name: "Email", exact: true })
        .fill(`${role}@acceptance.example.test`);
      await page.getByLabel("Password", { exact: true }).fill(password);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(page).toHaveURL(`${web}/`);
      await expect(page.locator(".ng-account-label small")).toHaveText(role);
      // The role label is available before IAM finishes reconciling the session cache.
      // Wait for the ready account before interacting with stateful application views.
      await expect(page.locator(".ng-account-label strong")).not.toHaveText("Checking session…");
    };
    await signIn("admin");
    await page.getByRole("link", { name: "Explore the API", exact: true }).click();
    const adminOperation = page.getByRole("combobox", { name: "Select API operation" });
    await adminOperation.selectOption("updateCustomer");
    const bodyContract = page.getByRole("table", { name: "Request body", exact: true });
    await expect(bodyContract.getByRole("row").filter({ hasText: "name" })).toContainText(
      "Min. length: 1",
    );
    await expect(bodyContract.getByRole("row").filter({ hasText: "name" })).toContainText(
      "Max. length: 120",
    );
    await expect(bodyContract.getByRole("row").filter({ hasText: "state" })).toContainText(
      "One of: active, archived",
    );
    await expect(bodyContract.getByRole("row").filter({ hasText: "name" })).toContainText(
      "Optional",
    );
    await noPageOverflow();
    await page.screenshot({
      path: join(directory, "verified-explorer-desktop.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await noPageOverflow();
    await expect(bodyContract).toBeVisible();
    await page.screenshot({
      path: join(directory, "verified-explorer-mobile.png"),
      fullPage: true,
    });
    const requestPanel = page.getByRole("region", { name: "Try request", exact: true });
    const editor = requestPanel.getByRole("textbox", { name: "Request input (JSON)" });
    await editor.scrollIntoViewIfNeeded();
    await expect(editor).toBeVisible();
    await noPageOverflow();
    await page.screenshot({ path: join(directory, "verified-explorer-mobile-request.png") });
    await page.setViewportSize({ width: 1400, height: 1000 });
    await editor.fill("{");
    await page.getByRole("button", { name: "Send request", exact: true }).click();
    await expect(requestPanel.getByRole("alert")).toContainText("Invalid JSON");
    await adminOperation.selectOption("getCustomer");
    await expect(requestPanel.getByRole("alert")).toHaveCount(0);
    await editor.fill(JSON.stringify({ path: { customerId: "not-a-uuid" } }));
    await page.getByRole("button", { name: "Send request", exact: true }).click();
    await expect(requestPanel.getByRole("alert")).toContainText('"status": 400');
    await adminOperation.selectOption("createCustomer");
    await expect(requestPanel.getByRole("alert")).toHaveCount(0);
    await expect(bodyContract.getByRole("row").filter({ hasText: "name" })).toContainText(
      "Required",
    );
    const explorerName = `Explorer ${state.id}`;
    await editor.fill(
      JSON.stringify({
        body: { name: explorerName, email: `${state.id}@explorer.example.test`, state: "active" },
      }),
    );
    const explorerCreated = page.waitForResponse(
      (response) =>
        response.url() === `${browserApi}/api/customers` && response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Send request", exact: true }).click();
    expect((await explorerCreated).status()).toBe(200);
    await expect(page.getByRole("heading", { name: "Response", exact: true })).toBeVisible();
    await expect(page.locator(".ng-json-output")).toContainText(explorerName);
    const explorerSaved = await (
      await admin.get(`/api/customers?search=${encodeURIComponent(explorerName)}`)
    ).json();
    expect(explorerSaved.items[0].entity.name).toBe(explorerName);
    await page.getByRole("link", { name: "← Workspace", exact: true }).click();
    await expect(page).toHaveURL(`${web}/`);
    await passed(
      "Explorer renders readable constraints and enums on desktop/mobile, handles invalid JSON and backend errors, and persists a real authorized request",
    );
    await page.goto(`${web}/invoice`);
    await expect(page.getByRole("heading", { name: "Invoice Management" })).toBeVisible();
    await expect(page.getByRole("button", { name: "+ New Invoice", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Delete", exact: true })).toHaveCount(0);
    const note = `Browser acceptance ${state.id}`;
    await page.locator('input[id="filter-search"]').fill(note);
    const filteredResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/backend/api/api/invoices" &&
        new URL(response.url()).searchParams.get("search") === note &&
        response.request().method() === "GET",
    );
    await page.getByRole("button", { name: "Apply filters", exact: true }).click();
    const emptyResult = await filteredResponse;
    expect(emptyResult.status()).toBe(200);
    expect((await emptyResult.json()).total).toBe(0);
    await expect(page.getByText("No records found.", { exact: true })).toBeVisible();
    await expect(page.getByRole("table")).toHaveCount(0);
    await page.getByRole("button", { name: "+ New Invoice", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.locator("#customerId").fill(persistence.customerId);
    await dialog.locator("#total").fill("19.75");
    await dialog.getByRole("checkbox", { name: "Set note to null", exact: true }).uncheck();
    await dialog.locator("#note").fill(note);
    await dialog.locator("#issuedAt").fill("2026-10-18T10:20");
    await dialog.locator("#payload").fill('{"currency":"EUR","source":"browser"}');
    const createResponse = page.waitForResponse(
      (response) =>
        response.url() === `${browserApi}/api/invoices` && response.request().method() === "POST",
    );
    await dialog.getByRole("button", { name: "Create", exact: true }).click();
    const createdFromBrowser = await createResponse;
    expect(createdFromBrowser.status()).toBe(200);
    const browserInvoice = (await createdFromBrowser.json())[0].entity;
    expect(browserInvoice).toMatchObject({
      total: 19.75,
      note,
      discount: null,
      payload: { currency: "EUR", source: "browser" },
      enabled: true,
      issuedAt: "2026-10-18T15:20:00.000Z",
    });
    await expect(dialog).not.toBeVisible();
    const row = page.getByRole("row").filter({ hasText: browserInvoice.id });
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "Edit", exact: true }).click();
    await expect(dialog).toBeVisible();
    await dialog.locator("#total").fill("3.25");
    await dialog.locator("#payload").fill('"browser scalar"');
    const updateResponse = page.waitForResponse(
      (response) =>
        response.url() === `${browserApi}/api/invoices/${browserInvoice.id}` &&
        response.request().method() === "PATCH",
    );
    await dialog.getByRole("button", { name: "Save changes", exact: true }).click();
    expect((await updateResponse).status()).toBe(200);
    await expect(dialog).not.toBeVisible();
    await expect(row).toBeVisible();
    const persisted = await (
      await admin.get(`/api/invoices?search=${encodeURIComponent(note)}`)
    ).json();
    expect(persisted.total).toBe(1);
    expect(persisted.items[0].entity).toMatchObject({
      id: browserInvoice.id,
      total: 3.25,
      payload: "browser scalar",
      issuedAt: "2026-10-18T15:20:00.000Z",
    });
    await page.screenshot({ path: join(directory, "verified-invoice.png"), fullPage: true });
    await passed(
      "Browser login, generated typed forms, decimal/JSON/null/date transport, mutation refetch and absent delete action",
    );

    for (const route of ["/sign-in", "/sign-up"]) {
      await page.goto(`${web}${route}`);
      await expect(page).toHaveURL(`${web}/`);
    }
    await page.getByLabel("Account menu", { exact: true }).click();
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page).toHaveURL(`${web}/sign-in`);
    await signIn("outsider");
    await page.goto(`${web}/invoice`);
    await expect(
      page.getByText("A permitted session is required to read these records.", { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("table")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "+ New Invoice", exact: true })).toHaveCount(0);
    await expect(page.getByText(browserInvoice.id, { exact: true })).toHaveCount(0);
    await page.screenshot({
      path: join(directory, "verified-account-isolation.png"),
      fullPage: true,
    });
    await passed(
      "Logout and a new denied account cannot display previous private records or mutation actions",
    );

    let releaseSession;
    const sessionGate = new Promise((resolve) => {
      releaseSession = resolve;
    });
    const delayedSession = async (route) => {
      await sessionGate;
      await route.continue();
    };
    const privateRequests = [];
    const trackPrivate = (outgoing) => {
      if (new URL(outgoing.url()).pathname === "/api/backend/api/api/invoices")
        privateRequests.push(outgoing.url());
    };
    page.on("request", trackPrivate);
    await page.route(`${web}/api/auth/get-session**`, delayedSession);
    try {
      await Promise.all([
        page.goto(`${web}/api-explorer`),
        page.waitForRequest(
          (outgoing) => outgoing.url().startsWith(`${web}/api/auth/get-session`),
          { timeout: 15_000 },
        ),
      ]);
      const operation = page.getByRole("combobox", { name: "Select API operation" });
      const send = page.getByRole("button", { name: "Send request", exact: true });
      await operation.selectOption("listInvoices");
      await expect(
        page.getByText("Checking your session before enabling this request.", { exact: true }),
      ).toBeVisible();
      await expect(send).toBeDisabled();
      releaseSession();
      await expect(page.locator(".ng-account-label small")).toHaveText("outsider");
      await operation.selectOption("listInvoices");
      const deniedMessage = page.getByText(
        "Your account does not have the roles or permissions required to send this request.",
        { exact: true },
      );
      // The permission-scoped query provider can remount the Explorer as IAM finishes loading.
      await expect
        .poll(async () => {
          await operation.selectOption("listInvoices");
          return deniedMessage.isVisible();
        })
        .toBe(true);
      await expect(send).toBeDisabled();
      await expect(send).toHaveAttribute("aria-describedby", "api-operation-access");
      await expect(send).toHaveCSS("cursor", "not-allowed");
      expect(
        await send.evaluate((button) => Number(getComputedStyle(button).opacity)),
      ).toBeLessThan(1);
      await send.evaluate((button) => button.click());
      await page.screenshot({
        path: join(directory, "verified-explorer-permissions.png"),
        fullPage: true,
      });
      await operation.selectOption("listCustomers");
      await expect(deniedMessage).toHaveCount(0);
      await expect(send).toBeEnabled();
      await expect(send).toHaveCSS("opacity", "1");
      const publicResponse = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === "/api/backend/api/api/customers" &&
          response.request().method() === "GET",
      );
      await send.click();
      expect((await publicResponse).status()).toBe(200);
      await expect(page.getByRole("heading", { name: "Response", exact: true })).toBeVisible();
      expect(privateRequests).toHaveLength(0);
    } finally {
      releaseSession();
      await page.unroute(`${web}/api/auth/get-session**`, delayedSession);
      page.off("request", trackPrivate);
    }
    await passed(
      "Explorer explains pending/denied requests without sending them, while a public operation remains executable",
    );

    const confirmedChange = async (context, path, data) => {
      let response = await context.post(path, { data });
      if (response.status() === 409) {
        const impact = await response.json();
        expect(impact.code).toBe("confirmation_required");
        response = await context.post(path, { data: { ...data, confirmation: impact.token } });
      }
      expect(response.status()).toBe(200);
    };
    const iamContext = await browser.newContext({ storageState: await admin.storageState() });
    const iamPage = await iamContext.newPage();
    iamPage.on("pageerror", (error) => browserErrors.push(error.message));
    await iamPage.goto(`${web}/admin/roles`);
    await expect(iamPage.getByRole("heading", { name: "Access administration" })).toBeVisible();
    await expect(iamPage.getByRole("heading", { name: "Roles", exact: true })).toBeVisible();
    await expect(iamPage.getByRole("button", { name: "Create role", exact: true })).toBeEnabled();
    await iamPage.screenshot({
      path: join(directory, "verified-iam-roles-desktop.png"),
      fullPage: true,
    });
    await iamPage.getByRole("button", { name: "Create role", exact: true }).click();
    const iamDialog = iamPage.getByRole("dialog");
    await iamDialog.getByLabel("ID", { exact: true }).fill("ui-reviewer");
    await iamDialog.getByLabel("Name", { exact: true }).fill("UI reviewer");
    await iamDialog.getByLabel("invoices:read", { exact: false }).check();
    await iamDialog.locator(".ng-dialog-content").evaluate((element) => {
      element.scrollTop = 0;
    });
    await iamPage.screenshot({
      path: join(directory, "verified-iam-role-editor.png"),
      fullPage: false,
    });
    await iamDialog.getByRole("button", { name: "Save role" }).click();
    await expect(iamDialog).toHaveCount(0);
    await expect(
      iamPage.getByRole("button", { name: "Edit ui-reviewer", exact: true }),
    ).toBeVisible();
    await iamPage.getByRole("searchbox", { name: "Search roles" }).fill("ui-reviewer");
    await expect(iamPage.getByRole("row")).toHaveCount(2);
    await iamPage.getByRole("searchbox", { name: "Search roles" }).fill("");
    await iamPage.setViewportSize({ width: 390, height: 844 });
    expect(
      await iamPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await iamPage.screenshot({
      path: join(directory, "verified-iam-roles-mobile.png"),
      fullPage: true,
    });
    await iamPage.setViewportSize({ width: 1400, height: 1000 });
    await iamPage.getByRole("tab", { name: /Users/ }).click();
    await expect(iamPage.getByRole("heading", { name: "Users", exact: true })).toBeVisible();
    const viewerRow = iamPage
      .getByRole("row")
      .filter({ hasText: "viewer@acceptance.example.test" });
    await viewerRow.getByRole("combobox").selectOption("ui-reviewer");
    await expect(viewerRow.getByRole("combobox")).toHaveValue("ui-reviewer");
    expect((await viewer.get("/api/invoices")).status()).toBe(200);
    await iamPage.getByRole("tab", { name: /Roles/ }).click();
    await iamPage.getByRole("button", { name: "Edit ui-reviewer", exact: true }).click();
    await iamDialog.getByLabel("invoices:read", { exact: false }).uncheck();
    await iamDialog.getByRole("button", { name: "Save role" }).click();
    await expect(iamDialog).toHaveCount(0);
    expect((await viewer.get("/api/invoices")).status()).toBe(403);
    const viewerId = persistence.identities.viewer;
    expect(
      (
        await admin.post(`/api/auth/iam/users/${viewerId}/role`, { data: { role: "viewer" } })
      ).status(),
    ).toBe(200);
    await iamPage.getByRole("button", { name: "Delete ui-reviewer", exact: true }).click();
    await iamPage
      .getByRole("dialog", { name: "Delete role?" })
      .getByRole("button", { name: "Cancel", exact: true })
      .click();
    await expect(
      iamPage.getByRole("button", { name: "Edit ui-reviewer", exact: true }),
    ).toBeVisible();
    await iamPage.getByRole("button", { name: "Delete ui-reviewer", exact: true }).click();
    await iamPage
      .getByRole("dialog", { name: "Delete role?" })
      .getByRole("button", { name: "Delete role", exact: true })
      .click();
    await expect(
      iamPage.getByRole("button", { name: "Edit ui-reviewer", exact: true }),
    ).toHaveCount(0);
    expect(
      (
        await admin.post("/api/auth/iam/roles", {
          data: { id: "support", name: "Support", permissions: ["iam:users:manage-roles"] },
        })
      ).status(),
    ).toBe(201);
    expect(
      (
        await admin.post(`/api/auth/iam/users/${persistence.identities.outsider}/role`, {
          data: { role: "support" },
        })
      ).status(),
    ).toBe(200);
    const supportContext = await browser.newContext({
      storageState: await outsider.storageState(),
    });
    const supportPage = await supportContext.newPage();
    await supportPage.goto(`${web}/admin/roles`);
    await expect(supportPage.getByRole("heading", { name: "Users", exact: true })).toBeVisible();
    await expect(supportPage.getByRole("heading", { name: "Roles", exact: true })).toHaveCount(0);
    await expect(supportPage.getByRole("button", { name: "Create role", exact: true })).toHaveCount(
      0,
    );
    expect((await outsider.get("/api/auth/iam/roles")).status()).toBe(403);
    expect((await outsider.get("/api/auth/iam/role-options")).status()).toBe(200);
    await supportPage.screenshot({
      path: join(directory, "verified-iam-user-operator.png"),
      fullPage: true,
    });
    await confirmedChange(admin, `/api/auth/iam/users/${persistence.identities.outsider}/role`, {
      role: "outsider",
    });
    await supportPage.goto(`${web}/admin/roles`);
    await expect(supportPage).toHaveURL(`${web}/`);
    await iamPage.bringToFront();
    // The sole full administrator cannot demote itself, even with a forged confirmation.
    await iamPage.getByRole("tab", { name: /Users/ }).click();
    await iamPage
      .getByRole("combobox", { name: "Role for admin@acceptance.example.test" })
      .selectOption("viewer");
    await expect(
      iamPage.getByRole("alert").filter({ hasText: "Keep at least one user" }),
    ).toBeVisible();
    expect((await admin.get("/api/auth/iam/me")).status()).toBe(200);
    await iamPage.screenshot({
      path: join(directory, "verified-iam-last-admin.png"),
      fullPage: true,
    });
    expect(
      (
        await admin.post("/api/auth/iam/roles", {
          data: {
            id: "delegated-admin",
            name: "Delegated administrator",
            permissions: ["iam:roles:manage", "iam:users:manage-roles"],
          },
        })
      ).status(),
    ).toBe(201);
    await confirmedChange(admin, `/api/auth/iam/users/${persistence.identities.outsider}/role`, {
      role: "delegated-admin",
    });
    await iamPage.reload();
    await iamPage.getByRole("tab", { name: /Users/ }).click();
    await iamPage
      .getByRole("combobox", { name: "Role for outsider@acceptance.example.test" })
      .selectOption("outsider");
    const otherWarning = iamPage.getByRole("dialog", {
      name: "Remove administrative access?",
      exact: true,
    });
    await expect(otherWarning).toBeVisible();
    await expect(otherWarning.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
    await otherWarning.getByRole("button", { name: "Cancel", exact: true }).click();
    expect((await outsider.get("/api/auth/iam/me")).status()).toBe(200);
    await iamPage
      .getByRole("combobox", { name: "Role for outsider@acceptance.example.test" })
      .selectOption("outsider");
    await otherWarning.getByRole("button", { name: "Confirm access change" }).click();
    await expect(otherWarning).toHaveCount(0);
    expect((await outsider.get("/api/auth/iam/roles")).status()).toBe(403);
    await confirmedChange(admin, `/api/auth/iam/users/${persistence.identities.outsider}/role`, {
      role: "delegated-admin",
    });
    await supportPage.bringToFront();
    await supportPage.goto(`${web}/admin/roles`);
    await supportPage.getByRole("button", { name: "Edit delegated-admin", exact: true }).click();
    await supportPage
      .getByRole("dialog")
      .getByLabel("iam:roles:manage", { exact: false })
      .uncheck();
    await supportPage.getByRole("button", { name: "Save role", exact: true }).click();
    const selfWarning = supportPage.getByRole("dialog", {
      name: "Remove your own administrative access?",
      exact: true,
    });
    await expect(selfWarning).toBeVisible();
    await expect(selfWarning).toContainText("Manage roles & permissions");
    await expect(selfWarning.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
    await supportPage.screenshot({
      path: join(directory, "verified-iam-self-warning.png"),
      fullPage: false,
    });
    await selfWarning.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(supportPage.getByRole("dialog", { name: "Edit role", exact: true })).toBeVisible();
    await supportPage.getByRole("button", { name: "Save role", exact: true }).click();
    await selfWarning.getByRole("button", { name: "Confirm access change" }).click();
    await expect(supportPage.getByRole("heading", { name: "Users", exact: true })).toBeVisible();
    await expect(supportPage.getByRole("button", { name: "Create role", exact: true })).toHaveCount(
      0,
    );
    await supportPage
      .getByRole("combobox", { name: "Role for outsider@acceptance.example.test" })
      .selectOption("outsider");
    await expect(selfWarning).toBeVisible();
    await expect(selfWarning).toContainText("Assign user roles");
    await selfWarning.getByRole("button", { name: "Confirm access change" }).click();
    await expect(supportPage).toHaveURL(`${web}/`);
    await expect
      .poll(async () => {
        const response = await admin.get("/api/auth/iam/audit?action=iam.role.updated");
        expect(response.status()).toBe(200);
        return (await response.json()).total;
      })
      .toBeGreaterThan(0);
    const businessAudit = await admin.get("/api/auth/iam/audit?action=invoice.created&pageSize=1");
    expect((await businessAudit.json()).items[0]).toMatchObject({
      action: "invoice.created",
      resourceType: "invoice",
      after: expect.any(Array),
    });
    expect((await outsider.get("/api/auth/iam/audit")).status()).toBe(403);
    const firstAudit = await (await admin.get("/api/auth/iam/audit?pageSize=1")).json();
    const secondAudit = await (await admin.get("/api/auth/iam/audit?pageSize=1&page=2")).json();
    expect(firstAudit.items[0].id).not.toBe(secondAudit.items[0].id);
    await iamPage.getByRole("tab", { name: "Activity", exact: true }).click();
    await expect(iamPage.getByRole("heading", { name: "Activity", exact: true })).toBeVisible();
    await iamPage.getByLabel("Action", { exact: true }).fill("iam.role.updated");
    await iamPage.getByLabel("Actor ID", { exact: true }).fill(persistence.identities.admin);
    await iamPage.getByLabel("From", { exact: true }).fill("2000-01-01T00:00");
    await iamPage.getByLabel("To", { exact: true }).fill("2099-01-01T00:00");
    await iamPage.getByRole("button", { name: "Apply filters", exact: true }).click();
    const activity = iamPage.locator(".ng-audit-events>li").first();
    await expect(activity).toBeVisible();
    await expect(activity).toContainText("iam.role.updated");
    await activity.getByText("Inspect changes", { exact: true }).click();
    await expect(
      activity.getByRole("heading", { name: "Before", exact: true }).first(),
    ).toBeVisible();
    await expect(
      activity.getByRole("heading", { name: "After", exact: true }).first(),
    ).toBeVisible();
    await iamPage.screenshot({
      path: join(directory, "verified-unified-audit-desktop.png"),
      fullPage: true,
    });
    await iamPage.setViewportSize({ width: 390, height: 844 });
    expect(
      await iamPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await iamPage.screenshot({
      path: join(directory, "verified-unified-audit-mobile.png"),
      fullPage: true,
    });
    await iamPage.setViewportSize({ width: 1400, height: 1000 });
    await iamPage.getByLabel("Action", { exact: true }).fill("missing.event");
    await iamPage.getByRole("button", { name: "Apply filters", exact: true }).click();
    await expect(
      iamPage.getByText("No activity matches these filters.", { exact: true }),
    ).toBeVisible();
    await passed(
      "Unified audit records auth, IAM and business changes; protected filtering, pagination and desktop/mobile diff inspection work",
    );

    // Leave the retained demo ready for all three manual scenarios.
    expect(
      (
        await admin.put("/api/auth/iam/roles/delegated-admin", {
          data: { permissions: ["iam:roles:manage", "iam:users:manage-roles"] },
        })
      ).status(),
    ).toBe(200);
    await confirmedChange(admin, `/api/auth/iam/users/${persistence.identities.outsider}/role`, {
      role: "delegated-admin",
    });
    await passed(
      "Administrative loss requires focused Cancel/explicit confirmation; self role edits and reassignments refresh access; the final administrator is blocked and changes are audited",
    );
    await supportContext.close();
    await iamContext.close();
    await passed(
      "IAM role editing and user reassignment work in the browser; database grants apply on the next request and user-only operators cannot edit roles",
    );

    const expiredContext = await browser.newContext({
      storageState: await accountant.storageState(),
    });
    const expiredPage = await expiredContext.newPage();
    await expiredPage.goto(`${web}/invoice`);
    await expect(expiredPage).toHaveURL(`${web}/invoice`);
    await expireAccountant();
    await expiredPage.goto(`${web}/invoice`);
    await expect(expiredPage).toHaveURL(`${web}/sign-in`);
    expect((await accountant.get("/api/invoices")).status()).toBe(401);
    const old = await viewer.storageState();
    expect((await viewer.post("/api/auth/sign-out", { data: {} })).status()).toBe(200);
    const replay = await request.newContext({ baseURL: api, storageState: old });
    contexts.push(replay);
    expect((await replay.get("/api/invoices")).status()).toBe(401);
    const replayContext = await browser.newContext({ storageState: old });
    const replayPage = await replayContext.newPage();
    await replayPage.goto(`${web}/invoice`);
    await expect(replayPage).toHaveURL(`${web}/sign-in`);
    await passed(
      "Expired sessions and replayed signed cookies after logout fail at both page/API boundaries",
    );
    expect([...browserOrigins]).toEqual([web]);
    const authContext = await browser.newContext();
    const authPage = await authContext.newPage();
    const lastDevValue = async (pattern) => {
      let value;
      await expect
        .poll(async () => {
          const log = await readFile(join(directory, "backend.log"), "utf8");
          value = [...log.matchAll(pattern)].at(-1)?.[1];
          return Boolean(value);
        })
        .toBe(true);
      return value;
    };
    await authPage.goto(`${web}/sign-up`);
    await authPage.getByLabel("Name", { exact: true }).fill("Recovery member");
    await authPage
      .getByRole("textbox", { name: "Email", exact: true })
      .fill("recovery@acceptance.example.test");
    await authPage
      .getByLabel("Password (at least 8 characters)", { exact: true })
      .fill("original-password-2026");
    await authPage.getByRole("button", { name: "Create account", exact: true }).click();
    await expect(authPage).toHaveURL(`${web}/`);
    await authPage.goto(`${web}/forgot-password`);
    await authPage
      .getByRole("textbox", { name: "Email", exact: true })
      .fill("recovery@acceptance.example.test");
    await authPage.getByRole("button", { name: "Send reset link", exact: true }).click();
    await expect(
      authPage.getByText("If an account exists, check your email for a password reset link.", {
        exact: true,
      }),
    ).toBeVisible();
    const resetLink = await lastDevValue(
      /\[DEV AUTH\] Email for recovery@acceptance\.example\.test: (\S+)/g,
    );
    const resetResponse = await authContext.request.get(resetLink, { maxRedirects: 0 });
    const resetLocation = resetResponse.headers().location;
    assert.ok(resetLocation?.startsWith(`${web}/reset-password`));
    await authPage.goto(resetLocation);
    await authPage.getByLabel("New password", { exact: true }).fill("updated-password-2026");
    await authPage
      .getByLabel("Confirm password / PIN", { exact: true })
      .fill("updated-password-2026");
    await authPage.getByRole("button", { name: "Save password", exact: true }).click();
    await expect(authPage).toHaveURL(`${web}/sign-in`);
    await authPage
      .getByRole("textbox", { name: "Email", exact: true })
      .fill("recovery@acceptance.example.test");
    await authPage.getByLabel("Password", { exact: true }).fill("updated-password-2026");
    await authPage.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(authPage).toHaveURL(`${web}/`);
    for (const resetUrl of [
      resetLocation,
      `${web}/reset-password`,
      `${web}/reset-password?token=not-a-valid-token`,
    ]) {
      await authPage.goto(resetUrl);
      await expect(authPage).toHaveURL(`${web}/forgot-password?error=INVALID_TOKEN`);
      await expect(
        authPage.getByText(
          "This reset link is invalid, expired or already used. Request a new link below.",
          { exact: true },
        ),
      ).toBeVisible();
      await expect(authPage.getByLabel("New password", { exact: true })).toHaveCount(0);
    }
    await authContext.clearCookies();
    await authPage.goto(`${web}/sign-in`);
    await authPage.getByRole("tab", { name: "Phone", exact: true }).click();
    await authPage.getByLabel("Your name", { exact: true }).fill("Phone member");
    await authPage.getByLabel("Country and calling code").click();
    await authPage.getByLabel("Search country or calling code").fill("+51");
    await authPage.locator(".ng-country-options button").filter({ hasText: "Peru" }).click();
    await authPage.getByLabel("Phone number", { exact: true }).fill("999111001");
    await authPage.getByRole("button", { name: "Send code", exact: true }).click();
    await expect(
      authPage.getByRole("button", { name: /Request another code in \d+s/ }),
    ).toBeDisabled();
    const prematureSms = await authContext.request.post(`${web}/api/auth/phone-number/send-otp`, {
      headers: { origin: web },
      data: { phoneNumber: "+51999111001" },
    });
    expect(prematureSms.status()).toBe(429);
    expect(Number(prematureSms.headers()["retry-after"])).toBeGreaterThan(0);
    const otp = await lastDevValue(/\[DEV AUTH\] SMS OTP for \+51999111001: (\d{6})/g);
    await authPage.getByLabel("Verification code", { exact: true }).fill(otp);
    await authPage.getByRole("button", { name: "Verify code", exact: true }).click();
    await expect(authPage).toHaveURL(`${web}/`);
    await authPage.goto(`${web}/profile`);
    await expect(
      authPage.getByRole("heading", { name: "Your profile", exact: true }),
    ).toBeVisible();
    await expect(
      authPage.getByRole("heading", { name: "Phone member", exact: true }),
    ).toBeVisible();
    await authPage.getByLabel("Country and calling code").click();
    await authPage.getByLabel("Search country or calling code").fill("Perú");
    await authPage.locator(".ng-country-options button").filter({ hasText: "Peru" }).click();
    await authPage.getByLabel("Phone number", { exact: true }).fill("999111002");
    await authPage.getByRole("button", { name: "Send code", exact: true }).click();
    const linkedOtp = await lastDevValue(/\[DEV AUTH\] SMS OTP for \+51999111002: (\d{6})/g);
    await authPage.getByLabel("Verification code", { exact: true }).fill(linkedOtp);
    await authPage.getByRole("button", { name: "Verify code", exact: true }).click();
    await expect(
      authPage.getByText("Phone number linked. You can use it to sign in.", { exact: true }),
    ).toBeVisible();
    await authContext.close();
    await passed(
      "Browser signup, password recovery/reset, phone OTP registration and protected profile linking use real generated handlers",
    );
    expect(browserErrors).toEqual([]);
    await passed("The connected browser journey completes without uncaught application errors");
    return behaviors;
  } catch (error) {
    if (page)
      await page
        .screenshot({ path: join(directory, "failure.png"), fullPage: true })
        .catch(() => {});
    throw error;
  } finally {
    await browser?.close();
    for (const context of contexts) await context.dispose();
  }
}
