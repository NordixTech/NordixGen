import * as hono from "hono";
import { describe, expect, it, vi } from "vitest";
import * as zod from "zod";
import { validateNordixConfig } from "../src/configuration/validate.js";
import { generateBackend } from "../src/generation/backend.js";
import { generateFrontend } from "../src/generation/frontend.js";
import { resolvedFixture, targetConfig } from "./fixtures.js";
import { generatedRuntime } from "./generated-runtime.js";

const root = "apps/api/src";
function fixture() {
  const config = targetConfig();
  const project = resolvedFixture(config);
  const output = generateBackend(project, "api");
  if (!output.success) throw Error("Invalid IAM fixture");
  const files = output.virtualFileSystem.snapshot();
  const catalog = new Map([
    [
      "admin",
      { id: "admin", name: "Admin", description: null, isSystem: true, permissions: ["*"] },
    ],
    [
      "viewer",
      {
        id: "viewer",
        name: "Viewer",
        description: null,
        isSystem: true,
        permissions: ["customers:read"],
      },
    ],
  ]);
  let principal: { id: string; role: string; permissions: string[] } | undefined = {
    id: "operator",
    role: "admin",
    permissions: ["*"],
  };
  let signedIn = true;
  const repository = {
    principal: vi.fn(async () => principal),
    roles: vi.fn(async () => [...catalog.values()]),
    users: vi.fn(async () => ({
      items: [{ id: "user", name: "User", email: "user@example.test", role: "viewer" }],
      total: 1,
    })),
    create: vi.fn(
      async (role: {
        id: string;
        name: string;
        description?: string | null;
        permissions: string[];
      }) => {
        if (catalog.has(role.id)) return false;
        catalog.set(role.id, { ...role, description: role.description ?? null, isSystem: false });
        return true;
      },
    ),
    audit: vi.fn(async () => []),
    change: vi.fn(
      async (change: {
        kind: string;
        id: string;
        role?: string;
        name?: string;
        description?: string | null;
        permissions?: string[];
      }) => {
        const result = { code: "ok", token: "impact-token", selfLoss: [], lost: [], affected: 1 };
        if (change.kind === "user")
          return {
            ...result,
            code: change.id === "user" && catalog.has(change.role ?? "") ? "ok" : "not_found",
          };
        const old = catalog.get(change.id);
        if (!old) return { ...result, code: "not_found" };
        catalog.set(change.id, { ...old, ...change });
        return result;
      },
    ),
    delete: vi.fn(async (id: string) => {
      if (!catalog.has(id) || catalog.get(id)?.isSystem) return false;
      return catalog.delete(id);
    }),
  };
  const load = generatedRuntime(files, {
    hono,
    zod,
    [`${root}/platform/auth/auth.ts`]: {
      isTrustedAuthOrigin: (origin: string) => origin === "https://web.example.test",
    },
  });
  const factory = load(`${root}/platform/authorization/routes.ts`).createIamRoutes as (
    repository: unknown,
    verify: unknown,
  ) => hono.Hono;
  const app = factory(repository, async () => (signedIn ? { id: "operator" } : null));
  const request = (
    path: string,
    method = "GET",
    body?: unknown,
    origin = "https://web.example.test",
  ) =>
    app.request(`/api/iam${path}`, {
      method,
      headers: { origin, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  return {
    config,
    project,
    files,
    catalog,
    repository,
    request,
    setPrincipal: (value: typeof principal) => {
      principal = value;
    },
    signOut: () => {
      signedIn = false;
    },
  };
}
describe("generated dynamic IAM", () => {
  it("mounts platform IAM, emits typed capabilities and a protected administration screen", () => {
    const f = fixture();
    expect(f.files[`${root}/index.ts`]).toContain('app.all("/api/iam/*"');
    expect(f.files[`${root}/platform/database/migrate.ts`]).toContain(
      "await seedAuthorization(db)",
    );
    expect(f.files[`${root}/platform/database/schema/auth-schema.ts`]).toContain(
      "references(() => authRoles.id",
    );
    expect(f.files[`${root}/platform/authorization/policy.ts`]).not.toContain("rolePermissions");
    const web = generateFrontend(f.project, "web").virtualFileSystem.snapshot();
    expect(web["apps/web/src/app/admin/roles/page.tsx"]).toContain("await requireIamAccess()");
    expect(web["apps/web/src/lib/auth/permissions.ts"]).not.toContain("rolePermissions");
    expect(web["apps/web/src/components/iam/administration.tsx"]).toContain("manageRoles&&");
    expect(web["apps/web/src/app/page.tsx"]).not.toContain('href="/admin/roles"');
    expect(web["apps/web/src/components/auth/auth-controls.tsx"]).toContain(
      'hasPermission("iam:roles:manage")||hasPermission("iam:users:manage-roles")',
    );
  });
  it("creates roles, rejects unknown grants, updates metadata/grants and protects defaults and admin", async () => {
    const f = fixture();
    expect(
      (
        await f.request("/roles", "POST", {
          id: "auditor",
          name: "Auditor",
          permissions: ["customers:read"],
        })
      ).status,
    ).toBe(201);
    expect(
      (await f.request("/roles", "POST", { id: "auditor", name: "Auditor", permissions: [] }))
        .status,
    ).toBe(409);
    for (const permissions of [
      ["unregistered:capability"],
      ["*"],
      ["customers:read", "customers:read"],
    ])
      expect(
        (await f.request("/roles", "POST", { id: "bad", name: "Bad", permissions })).status,
      ).toBe(400);
    expect((await f.request("/roles/auditor", "PUT", { name: "Audit team" })).status).toBe(200);
    expect(f.catalog.get("auditor")).toMatchObject({
      name: "Audit team",
      permissions: ["customers:read"],
    });
    expect((await f.request("/roles/auditor", "PUT", { permissions: [] })).status).toBe(200);
    expect((await f.request("/roles/admin", "PUT", { permissions: [] })).status).toBe(400);
    expect(
      (await f.request("/roles/viewer", "PUT", { permissions: ["iam:roles:manage"] })).status,
    ).toBe(400);
    expect(
      (await f.request("/roles/viewer", "PUT", { permissions: ["iam:users:manage-roles"] })).status,
    ).toBe(400);
    expect((await f.request("/roles/admin", "DELETE")).status).toBe(409);
    expect((await f.request("/roles/viewer", "DELETE")).status).toBe(409);
    expect((await f.request("/roles/auditor", "DELETE")).status).toBe(204);
    expect((await f.request("/roles/missing", "PUT", { name: "Missing" })).status).toBe(404);
    expect((await f.request("/roles/missing", "PUT", {})).status).toBe(400);
  });
  it("separates user role assignment from role editing and exposes only minimal role options", async () => {
    const f = fixture();
    f.setPrincipal({ id: "hr", role: "hr", permissions: ["iam:users:manage-roles"] });
    const options = await f.request("/role-options");
    expect(options.status).toBe(200);
    expect(await options.json()).toEqual([
      { id: "admin", name: "Admin" },
      { id: "viewer", name: "Viewer" },
    ]);
    expect((await f.request("/users?page=1&pageSize=10")).status).toBe(200);
    expect(f.repository.users).toHaveBeenCalledWith(10, 0);
    expect((await f.request("/users?pageSize=101")).status).toBe(400);
    expect((await f.request("/users/user/role", "POST", { role: "admin" })).status).toBe(200);
    expect((await f.request("/users/user/role", "POST", { role: "missing" })).status).toBe(404);
    expect(
      (await f.request("/users/user/role", "POST", { role: "admin", extra: true })).status,
    ).toBe(400);
    for (const path of ["/roles", "/permissions"]) expect((await f.request(path)).status).toBe(403);
    for (const [path, method] of [
      ["/roles", "POST"],
      ["/roles/admin", "PUT"],
      ["/roles/admin", "DELETE"],
    ])
      expect((await f.request(path, method, {})).status).toBe(403);
    f.setPrincipal({ id: "roles", role: "roles", permissions: ["iam:roles:manage"] });
    for (const path of ["/role-options", "/users"])
      expect((await f.request(path)).status).toBe(403);
    expect((await f.request("/users/user/role", "POST", { role: "admin" })).status).toBe(403);
  });
  it("returns reviewable impact and non-overridable last-administrator conflicts", async () => {
    const f = fixture();
    for (const [code, status] of [
      ["confirmation_required", 409],
      ["last_admin", 409],
      ["forbidden", 403],
      ["protected", 400],
      ["not_found", 404],
    ] as const) {
      f.repository.change.mockResolvedValueOnce({
        code,
        token: "impact-token",
        selfLoss: ["iam:users:manage-roles"],
        lost: ["iam:users:manage-roles"],
        affected: 1,
      } as never);
      const response = await f.request("/users/user/role", "POST", {
        role: "viewer",
        confirmation: "previous-impact",
      });
      expect(response.status).toBe(status);
      expect(await response.json()).toMatchObject({ code, token: "impact-token" });
    }
    expect((await f.request("/audit")).status).toBe(200);
    f.setPrincipal({ id: "hr", role: "hr", permissions: ["iam:users:manage-roles"] });
    expect((await f.request("/audit")).status).toBe(403);
  });
  it("checks verified sessions, current grants and mutation origin before writes", async () => {
    const f = fixture();
    expect((await f.request("/me")).headers.get("cache-control")).toBe("no-store");
    expect(
      (
        await f.request(
          "/roles",
          "POST",
          { id: "bad", name: "Bad", permissions: [] },
          "https://evil.example",
        )
      ).status,
    ).toBe(403);
    expect(f.repository.create).not.toHaveBeenCalled();
    f.setPrincipal({ id: "operator", role: "custom", permissions: [] });
    expect((await f.request("/roles")).status).toBe(403);
    f.setPrincipal(undefined);
    expect((await f.request("/me")).status).toBe(403);
    f.signOut();
    expect((await f.request("/roles")).status).toBe(401);
    const failed = fixture();
    failed.repository.roles.mockRejectedValueOnce(Error("private-database-details"));
    const failure = await failed.request("/roles");
    expect(failure.status).toBe(500);
    expect(await failure.text()).not.toContain("private-database-details");
  });
  it("rejects privileged signup defaults, unknown seed permissions, business role locks and platform collisions", () => {
    for (const grant of ["*", "iam:roles:manage", "iam:users:manage-roles"]) {
      const f = fixture();
      f.config.backends[0].authorization.rolePermissions.viewer = [grant];
      expect(validateNordixConfig(f.config).diagnostics).toContainEqual(
        expect.objectContaining({ code: "DEFAULT_ROLE_PRIVILEGED" }),
      );
    }
    const f = fixture();
    f.config.backends[0].authorization.defaultRole = "admin";
    expect(validateNordixConfig(f.config).success).toBe(false);
    f.config.backends[0].authorization.defaultRole = "viewer";
    f.config.backends[0].authorization.rolePermissions.admin = ["not:declared"];
    expect(validateNordixConfig(f.config).diagnostics).toContainEqual(
      expect.objectContaining({ code: "PERMISSION_UNKNOWN" }),
    );
    f.config.endpoints[0].roles = ["admin"];
    f.config.endpoints[0].path = "/api/iam/roles";
    const codes = validateNordixConfig(f.config).diagnostics.map((d) => d.code);
    expect(codes).toContain("ENDPOINT_ROLES_REMOVED");
    expect(codes).toContain("PLATFORM_ROUTE_RESERVED");
  });
  it("registers operation capabilities without requiring any initial role grant", () => {
    const config = targetConfig();
    config.endpoints[1].permissions.push("customers:archive");
    expect(validateNordixConfig(config).success).toBe(true);
    expect(resolvedFixture(config).backends.api.identity?.permissions).toContain(
      "customers:archive",
    );
    config.entities.AuthRoles = { ...structuredClone(config.entities.Customer), relations: {} };
    expect(validateNordixConfig(config).diagnostics).toContainEqual(
      expect.objectContaining({ code: "GENERATED_NAME_COLLISION", path: "entities.AuthRoles" }),
    );
  });
});
