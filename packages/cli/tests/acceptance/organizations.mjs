import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect as baseExpect, chromium, request } from "@playwright/test";
import { verifyAccessDialog } from "./access-dialog.mjs";
const expect = baseExpect.configure({ timeout: 20000 });
const password = "acceptance-local-password-2026";
export async function verifyOrganizationApplication(state, directory) {
  const web = `http://localhost:${state.webPort}`;
  const api = `http://localhost:${state.apiPort}`;
  const browser = await chromium.launch();
  const alice = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const bob = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await alice.newPage();
  const sessionDelay = state.sessionDelay ?? 1500;
  if (sessionDelay)
    await page.route("**/api/auth/get-session*", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, sessionDelay));
      await route.continue();
    });
  const behaviors = [];
  const passed = async (name) => {
    behaviors.push(name);
    console.log("  Verified:", name);
    await writeFile(join(directory, "behaviors.json"), JSON.stringify(behaviors, null, 2));
  };
  const apiClient = await request.newContext({ baseURL: api, extraHTTPHeaders: { origin: web } });
  try {
    for (const name of ["alice", "bob"]) {
      const response = await apiClient.post("/api/auth/sign-up/email", {
        data: {
          name,
          email: `${name}@organization.example.test`,
          password,
          role: "admin",
          roles: ["admin"],
        },
      });
      expect(response.status(), await response.text()).toBe(200);
    }
    await page.goto(`${web}/sign-in`);
    await page
      .getByRole("textbox", { name: "Email", exact: true })
      .fill("alice@organization.example.test");
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.getByRole("button", { name: "Active organization", exact: true }).click();
    await expect(page.getByRole("button", { name: "New organization", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "New organization", exact: true }).click();
    let dialog = page.getByRole("dialog");
    await verifyAccessDialog(page, directory, "organization-create-form.png");
    await dialog.getByLabel("Organization name").fill("Company A");
    await dialog.getByLabel("Organization identifier").fill("company-a");
    await dialog.getByRole("button", { name: "Create organization", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Active organization", exact: true }),
    ).toContainText("Company A");
    await passed(
      "Organization creation assigns a contextual owner and updates the verified workspace",
    );
    const organizationA = (await (await alice.request.get(`${web}/api/auth/iam/me`)).json())
      .organizationId;
    await page.goto(`${web}/organization/settings/roles`);
    await expect(
      page.getByRole("heading", { name: "Organization roles", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Create role", exact: true }).click();
    dialog = page.getByRole("dialog");
    await verifyAccessDialog(page, directory, "organization-role-form.png");
    await dialog.getByRole("searchbox", { name: "Find a permission" }).fill("customers");
    await expect(dialog.getByRole("checkbox")).toHaveCount(2);
    await dialog.getByRole("searchbox", { name: "Find a permission" }).fill("");
    await dialog.getByLabel("Role name").fill("Local auditor");
    await dialog.getByLabel("Description").fill("Organization-specific reporting");
    await dialog.getByLabel("customers:read", { exact: false }).check();
    await dialog.getByRole("button", { name: "Save role", exact: true }).click();
    await expect(page.getByRole("row").filter({ hasText: "Local auditor" })).toBeVisible();
    const roleRow = page.getByRole("row").filter({ hasText: "Local auditor" });
    await roleRow.getByRole("button", { name: "Edit Local auditor", exact: true }).click();
    dialog = page.getByRole("dialog");
    await dialog.getByLabel("Description").fill("Changed without regeneration");
    await dialog.getByRole("button", { name: "Save role", exact: true }).click();
    await expect(roleRow).toContainText("Changed without regeneration");
    await roleRow.getByRole("button", { name: "Delete Local auditor", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Delete role", exact: true })
      .click();
    await expect(roleRow).toHaveCount(0);
    await passed(
      "Dynamic organization roles can be created, edited and deleted through the generated UI",
    );
    await page.goto(`${web}/admin/roles`);
    await expect(page).not.toHaveURL(/\/admin\/roles/);
    expect((await alice.request.get(`${web}/api/auth/iam/roles`)).status()).toBe(403);
    await passed("An organization owner has no implicit platform administration access");
    const bobLogin = await bob.request.post(`${web}/api/auth/sign-in/email`, {
      headers: { origin: web },
      data: { email: "bob@organization.example.test", password },
    });
    expect(bobLogin.status(), await bobLogin.text()).toBe(200);
    const companyB = await bob.request.post(`${web}/api/auth/iam/organizations`, {
      headers: { origin: web },
      data: { name: "Company B", slug: "company-b" },
    });
    expect(companyB.status(), await companyB.text()).toBe(200);
    const organizationB = (await companyB.json()).id;
    expect(
      (
        await alice.request.get(`${web}/api/auth/iam/organizations/roles`, {
          headers: { "x-organization-id": organizationB },
        })
      ).status(),
    ).toBe(403);
    const aCustomer = await alice.request.post(`${web}/api/backend/api/api/customers`, {
      headers: { origin: web, "x-organization-id": organizationA },
      data: { name: "Only Company A", email: "same@tenant.example.test" },
    });
    expect(aCustomer.status(), await aCustomer.text()).toBe(200);
    const bCustomer = await bob.request.post(`${web}/api/backend/api/api/customers`, {
      headers: { origin: web, "x-organization-id": organizationB },
      data: { name: "Only Company B", email: "same@tenant.example.test" },
    });
    expect(bCustomer.status(), await bCustomer.text()).toBe(200);
    await page.goto(`${web}/customer`);
    await expect(page.getByText("Only Company A", { exact: true })).toBeVisible();
    await expect(page.getByText("Only Company B", { exact: true })).toHaveCount(0);
    const roles = await bob.request.get(`${web}/api/auth/iam/organizations/roles`);
    const viewer = (await roles.json()).find((role) => role.name === "viewer");
    assert.ok(viewer);
    const invite = await bob.request.post(`${web}/api/auth/iam/organizations/invitations`, {
      headers: { origin: web },
      data: { email: "alice@organization.example.test", roles: [viewer.id] },
    });
    expect(invite.status(), await invite.text()).toBe(200);
    const backendLog = await readFile(join(directory, "backend.log"), "utf8");
    const urls = [
      ...backendLog.matchAll(/Email for alice@organization\.example\.test: (http[^\s]+)/g),
    ];
    assert.ok(urls.length, "Development invitation delivery must contain a real acceptance link");
    const invitationUrl = urls.at(-1)[1];
    await page.goto(invitationUrl);
    await expect(page.getByRole("heading", { name: "Organization invitation" })).toBeVisible();
    await page.getByRole("button", { name: "Accept invitation", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Active organization", exact: true }),
    ).toContainText("Company B");
    await page.goto(`${web}/customer`);
    await expect(page.getByText("Only Company B", { exact: true })).toBeVisible();
    await expect(page.getByText("Only Company A", { exact: true })).toHaveCount(0);
    await page.goto(`${web}/organization/settings/roles`);
    await expect(page).not.toHaveURL(/\/organization\/settings\/roles/);
    await passed(
      "An email invitation activates a verified viewer membership and cannot inherit the other company’s owner permissions",
    );
    await page.getByRole("button", { name: "Active organization", exact: true }).click();
    await page.getByRole("button", { name: /Company A company-a/ }).click();
    await expect(
      page.getByRole("button", { name: "Active organization", exact: true }),
    ).toContainText("Company A");
    await page.goto(`${web}/customer`);
    await expect(page.getByText("Only Company A", { exact: true })).toBeVisible();
    await expect(page.getByText("Only Company B", { exact: true })).toHaveCount(0);
    await passed(
      "Switching organizations clears private data and restores only that organization’s grants",
    );
    await page.goto(`${web}/organization/settings/members`);
    await expect(
      page.getByRole("heading", { name: "Organization members", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Invite member", exact: true }).click();
    dialog = page.getByRole("dialog");
    await verifyAccessDialog(page, directory, "organization-invite-form.png");
    await dialog.getByLabel("Email address").fill("bob@organization.example.test");
    await dialog.locator(`input[value="${organizationA}:editor"]`).check();
    await dialog.locator(`input[value="${organizationA}:viewer"]`).check();
    await dialog.getByRole("button", { name: "Send invitation", exact: true }).click();
    await expect(page.getByText("Changes saved.", { exact: true })).toBeVisible();
    await passed("The member interface sends an invitation with several selected roles");
    const bobEmailLog = await readFile(join(directory, "backend.log"), "utf8");
    const bobInvites = [
      ...bobEmailLog.matchAll(/Email for bob@organization\.example\.test: (http[^\s]+)/g),
    ];
    assert.ok(bobInvites.length);
    const mobile = await bob.newPage();
    await mobile.goto(bobInvites.at(-1)[1]);
    await mobile.getByRole("button", { name: "Accept invitation", exact: true }).click();
    await expect(
      mobile.getByRole("button", { name: "Active organization", exact: true }),
    ).toContainText("Company A");
    await page.reload();
    const bobRow = page.getByRole("row").filter({ hasText: "bob@organization.example.test" });
    await expect(bobRow).toContainText("editor");
    await expect(bobRow).toContainText("viewer");
    await bobRow.getByRole("button", { name: "Change roles", exact: true }).click();
    dialog = page.getByRole("dialog");
    await dialog.locator(`input[value="${organizationA}:editor"]`).uncheck();
    await expect(dialog.locator(`input[value="${organizationA}:viewer"]`)).toBeChecked();
    await verifyAccessDialog(page, directory, "organization-member-roles-form.png");
    await dialog.getByRole("button", { name: "Save roles", exact: true }).click();
    await expect(bobRow).not.toContainText("editor");
    await bobRow.getByRole("button", { name: "Remove", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Remove member", exact: true })
      .click();
    await expect(bobRow).toHaveCount(0);
    await passed("Member role assignment and removal apply immediately through the interface");
    await expect(page.getByRole("table")).toBeVisible();
    await expect(page.getByText("Loading…", { exact: true })).toHaveCount(0);
    await page.screenshot({ path: join(directory, "organization-desktop.png"), fullPage: true });
    const activateB = await bob.request.post(`${web}/api/auth/iam/organizations/active`, {
      headers: { origin: web },
      data: { organizationId: organizationB },
    });
    expect(activateB.status()).toBe(200);
    await mobile.goto(`${web}/organization/settings/roles`);
    await expect(
      mobile.getByRole("heading", { name: "Organization roles", exact: true }),
    ).toBeVisible();
    await expect(mobile.getByRole("table")).toBeVisible();
    await expect(
      mobile.getByRole("button", { name: "Active organization", exact: true }),
    ).toContainText("Company B");
    expect(
      await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await mobile.screenshot({ path: join(directory, "organization-mobile.png"), fullPage: true });
    await mobile.getByRole("button", { name: "Create role", exact: true }).click();
    await verifyAccessDialog(mobile, directory, "organization-role-form-mobile.png");
    await mobile.getByRole("button", { name: "Cancel", exact: true }).click();
    await passed("Organization administration and styled forms render on desktop and mobile");
    return behaviors;
  } catch (error) {
    await page
      .screenshot({ path: join(directory, "organization-failure.png"), fullPage: true })
      .catch(() => {});
    await writeFile(
      join(directory, "organization-failure.txt"),
      await page
        .locator("body")
        .innerText()
        .catch(() => ""),
    );
    throw error;
  } finally {
    await apiClient.dispose();
    await alice.close();
    await bob.close();
    await browser.close();
  }
}
