import * as path from "node:path";
import * as url from "node:url";
import * as authAdapter from "@better-auth/drizzle-adapter";
import * as validator from "@hono/zod-validator";
import * as neon from "@neondatabase/serverless";
import * as betterAuth from "better-auth";
import * as authApi from "better-auth/api";
import * as authPlugins from "better-auth/plugins";
import * as orm from "drizzle-orm";
import * as neonOrm from "drizzle-orm/neon-http";
import * as transactions from "drizzle-orm/neon-serverless";
import * as pg from "drizzle-orm/pg-core";
import * as hono from "hono";
import * as cors from "hono/cors";
import * as httpException from "hono/http-exception";
import { expect } from "vitest";
import * as zod from "zod";
import { aiDependencies } from "./ai-dependencies.js";
import { generatedRuntime } from "./generated-runtime.js";

export async function verifyOrganizationIntegration(
  files: Readonly<Record<string, string>>,
  databaseUrl: string,
  sql: ReturnType<typeof neon.neon>,
  auditTasks: Promise<unknown>[],
  mode: "single" | "multiple",
) {
  const root = "apps/api/src";
  const emails: { to: string; url: string }[] = [];
  const live = generatedRuntime(files, {
    ...aiDependencies,
    zod,
    hono,
    "hono/cors": cors,
    "hono/http-exception": httpException,
    "@hono/zod-validator": validator,
    "drizzle-orm": orm,
    "drizzle-orm/pg-core": pg,
    "drizzle-orm/neon-http": neonOrm,
    "drizzle-orm/neon-serverless": transactions,
    "@neondatabase/serverless": neon,
    "better-auth": betterAuth,
    "better-auth/api": authApi,
    "better-auth/plugins": authPlugins,
    "@better-auth/drizzle-adapter": authAdapter,
    "node:path": path,
    "node:url": url,
    [`${root}/platform/auth/delivery.ts`]: {
      assertEmailDelivery: () => {},
      sendAuthEmail: async (_env: unknown, to: string, _subject: string, link: string) => {
        emails.push({ to, url: link });
      },
    },
  });
  const app = live(`${root}/index.ts`).default as hono.Hono;
  const env = {
    DATABASE_URL: databaseUrl,
    BETTER_AUTH_URL: "http://localhost:8787",
    BETTER_AUTH_SECRET: "isolated-test-secret-only-32-characters",
    AUTH_TRUSTED_ORIGINS: "http://localhost:3000",
  };
  const request = (
    route: string,
    cookie = "",
    method = "GET",
    body?: unknown,
    organizationId?: string,
  ) =>
    app.request(
      `http://localhost:8787${route}`,
      {
        method,
        headers: {
          origin: "http://localhost:3000",
          "content-type": "application/json",
          cookie,
          ...(organizationId ? { "x-organization-id": organizationId } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
      env,
      {
        waitUntil: (task) => {
          auditTasks.push(task);
        },
        passThroughOnException: () => {},
        props: {},
      },
    );
  const ok = async (
    route: string,
    cookie = "",
    method = "GET",
    body?: unknown,
    organizationId?: string,
  ) => {
    const response = await request(route, cookie, method, body, organizationId);
    expect(response.status, await response.clone().text()).toBeLessThan(300);
    return response.json();
  };
  async function signup(name: string) {
    const response = await request("/api/auth/sign-up/email", "", "POST", {
      name,
      email: `${name}@example.test`,
      password: "test-long-password-12",
      role: "admin",
      roles: ["admin"],
    });
    expect(response.status, await response.clone().text()).toBe(200);
    return {
      id: (await response.json()).user.id as string,
      cookie: response.headers
        .getSetCookie()
        .map((value) => value.split(";")[0])
        .join("; "),
    };
  }
  const alice = await signup("alice");
  const bob = await signup("bob");
  const me = await ok("/api/auth/iam/me", alice.cookie);
  expect(me.globalRoles).toEqual(["viewer"]);
  expect((await request("/api/invoices", alice.cookie)).status).toBe(403);
  const a = await ok("/api/auth/iam/organizations", alice.cookie, "POST", {
    name: "Company A",
    slug: "company-a",
  });
  const b = await ok("/api/auth/iam/organizations", bob.cookie, "POST", {
    name: "Company B",
    slug: "company-b",
  });
  expect((await ok("/api/auth/iam/me", alice.cookie)).organizationId).toBe(a.id);
  expect((await request("/api/auth/iam/roles", alice.cookie)).status).toBe(403);
  expect([403, 404]).toContain(
    (
      await request("/api/auth/organization/create", alice.cookie, "POST", {
        name: "Bypass",
        slug: "bypass",
      })
    ).status,
  );
  const org = "/api/auth/iam/organizations";
  expect((await request(`${org}/roles`, alice.cookie, "GET", undefined, b.id)).status).toBe(403);
  expect(
    (await request(`${org}/active`, alice.cookie, "POST", { organizationId: b.id })).status,
  ).toBe(403);
  const admin = live(`${root}/platform/authorization/create-admin.ts`) as {
    createAdmin(email: string): Promise<void>;
  };
  await admin.createAdmin("alice@example.test");
  expect((await request("/api/invoices", alice.cookie, "GET", undefined, b.id)).status).toBe(403);
  const bRoles = (await ok(`${org}/roles`, bob.cookie)) as { id: string; name: string }[];
  const viewer = bRoles.find((role) => role.name === "viewer")?.id;
  const editor = bRoles.find((role) => role.name === "editor")?.id;
  if (!viewer || !editor) throw Error("Missing organization seed roles");
  await ok(`${org}/invitations`, bob.cookie, "POST", {
    email: "alice@example.test",
    roles: [viewer],
  });
  const invitation = emails.at(-1);
  if (!invitation) throw Error("No invitation email was delivered");
  expect(new URL(invitation.url).origin).toBe("http://localhost:3000");
  const token = new URL(invitation.url).searchParams.get("token");
  if (!token) throw Error("Invitation token missing");
  expect((await request(`${org}/invitations/accept`, bob.cookie, "POST", { token })).status).toBe(
    403,
  );
  await ok(`${org}/invitations/accept`, alice.cookie, "POST", { token });
  expect((await request(`${org}/invitations/accept`, alice.cookie, "POST", { token })).status).toBe(
    400,
  );
  expect((await ok("/api/auth/iam/me", alice.cookie)).organizationPermissions).not.toContain("*");
  const chat = await ok("/api/ai/chats", alice.cookie, "POST", {}, a.id);
  expect((await ok("/api/ai/chats", alice.cookie, "GET", undefined, b.id)).chats).toEqual([]);
  expect(
    (await request(`/api/ai/chats/${chat.id}`, alice.cookie, "GET", undefined, b.id)).status,
  ).toBe(404);
  expect(
    (await request("/api/ai/chats", alice.cookie, "GET", undefined, "not-a-member")).status,
  ).toBe(403);
  const stores = live(`${root}/platform/ai/history.ts`) as {
    createChatStore(
      url: string,
      organizationId: string,
    ): {
      acquire(id: string, owner: string): Promise<string>;
      save(id: string, owner: string, token: string, messages: unknown[]): Promise<void>;
      load(id: string, owner: string): Promise<{ messages: unknown[] }>;
      release(id: string, owner: string, token: string): Promise<void>;
    };
  };
  const storeA = stores.createChatStore(databaseUrl, a.id);
  const storeB = stores.createChatStore(databaseUrl, b.id);
  const lease = await storeA.acquire(chat.id, alice.id);
  await storeB.save(chat.id, alice.id, lease, [
    { id: "injected", role: "user", parts: [{ type: "text", text: "Wrong organization" }] },
  ]);
  expect((await storeA.load(chat.id, alice.id)).messages).toEqual([]);
  await storeA.release(chat.id, alice.id, lease);
  expect((await request(`${org}/roles`, alice.cookie)).status).toBe(403);
  const idA = crypto.randomUUID();
  const idB = crypto.randomUUID();
  await sql(
    "INSERT INTO customer(id,name,email,organization_id) VALUES($1,'A','same@example.test',$2),($3,'B','same@example.test',$4)",
    [idA, a.id, idB, b.id],
  );
  const invoiceA = await ok(
    "/api/invoices",
    alice.cookie,
    "POST",
    { customerId: idA, total: 11 },
    a.id,
  );
  const invoiceB = await ok(
    "/api/invoices",
    bob.cookie,
    "POST",
    { customerId: idB, total: 22 },
    b.id,
  );
  expect(
    (
      await request(
        "/api/lines",
        alice.cookie,
        "POST",
        { invoiceId: invoiceB[0].entity.id, quantity: 1, unitPrice: 1 },
        a.id,
      )
    ).status,
  ).toBe(400);
  expect(
    (await request("/api/invoices", alice.cookie, "POST", { customerId: idB, total: 33 }, b.id))
      .status,
  ).toBe(403);
  const listA = await ok("/api/invoices", alice.cookie, "GET", undefined, a.id);
  const listB = await ok("/api/invoices", alice.cookie, "GET", undefined, b.id);
  expect(listA.total).toBe(1);
  expect(listB.total).toBe(1);
  expect(listA.items[0].entity.id).toBe(invoiceA[0].entity.id);
  expect(listB.items[0].entity.id).toBe(invoiceB[0].entity.id);
  await ok(`/api/invoices/${invoiceB[0].entity.id}`, alice.cookie, "PATCH", { total: 999 }, a.id);
  expect(
    Number((await sql("SELECT total FROM invoice WHERE id=$1", [invoiceB[0].entity.id]))[0].total),
  ).toBe(22);
  const aMembers = await ok(`${org}/members`, alice.cookie, "GET", undefined, a.id);
  const owner = aMembers.items[0];
  expect(
    (await request(`${org}/members/${owner.id}/remove`, alice.cookie, "POST", {}, a.id)).status,
  ).toBe(409);
  expect(
    (await request(`${org}/roles/${a.id}:owner`, alice.cookie, "PUT", { permissions: [] }, a.id))
      .status,
  ).toBe(400);
  expect(
    (
      await request(
        `${org}/roles/${a.id}:viewer`,
        alice.cookie,
        "PUT",
        { permissions: ["org:roles:manage"] },
        a.id,
      )
    ).status,
  ).toBe(400);
  expect(
    (await request(`${org}/roles/${a.id}:owner`, alice.cookie, "DELETE", undefined, a.id)).status,
  ).toBe(409);
  const custom = await ok(
    `${org}/roles`,
    alice.cookie,
    "POST",
    { name: "Auditor", description: "Dynamic", permissions: ["invoices:read"] },
    a.id,
  );
  await ok(
    `${org}/roles/${custom.id}`,
    alice.cookie,
    "PUT",
    { description: "Updated", permissions: [] },
    a.id,
  );
  await ok(`${org}/roles/${custom.id}`, alice.cookie, "DELETE", undefined, a.id);
  const members = await ok(`${org}/members`, bob.cookie);
  const aliceMember = members.items.find(
    (member: { userId: string }) => member.userId === alice.id,
  );
  const assigned = mode === "multiple" ? [viewer, editor] : [editor];
  const concurrent = await Promise.all(
    Array.from({ length: 20 }, () =>
      request(
        `${org}/members/${aliceMember.id}/roles`,
        bob.cookie,
        "POST",
        { roles: assigned },
        b.id,
      ),
    ),
  );
  for (const response of concurrent)
    expect(response.status, await response.clone().text()).toBe(200);
  expect((await ok("/api/auth/iam/me", alice.cookie)).organizationPermissions).toContain(
    "invoices:write",
  );
  expect(
    (
      await request(
        `${org}/members/${aliceMember.id}/roles`,
        bob.cookie,
        "POST",
        { roles: [`${a.id}:owner`] },
        b.id,
      )
    ).status,
  ).toBe(400);
  const global = await Promise.all(
    Array.from({ length: 20 }, () =>
      request(
        `/api/auth/iam/users/${bob.id}/role`,
        alice.cookie,
        "POST",
        mode === "multiple" ? { roles: ["viewer"] } : { role: "viewer" },
      ),
    ),
  );
  for (const response of global) expect(response.status, await response.clone().text()).toBe(200);
  const grantRows = await sql(
    "SELECT permission FROM auth_org_role_permissions WHERE org_role_id=$1",
    [`${a.id}:owner`],
  );
  expect(grantRows.map((row) => row.permission)).toEqual(["*"]);
  await sql("UPDATE member SET active=false WHERE organization_id=$1 AND user_id=$2", [
    b.id,
    alice.id,
  ]);
  expect((await request("/api/invoices", alice.cookie, "GET", undefined, b.id)).status).toBe(403);
}
