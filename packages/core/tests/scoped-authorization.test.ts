import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import { validateNordixConfig } from "../src/configuration/validate.js";
import { generateBackend } from "../src/generation/backend.js";
import { generateFrontend } from "../src/generation/frontend.js";
import { resolvedFixture, targetConfig } from "./fixtures.js";
import { frontendRuntime } from "./frontend-runtime.js";
import { generatedRuntime } from "./generated-runtime.js";
import { generatedTypeErrors } from "./generated-types.js";

function organizationFixture(
  globalMode: "single" | "multiple" = "single",
  organizationMode: "single" | "multiple" = "single",
) {
  const config = targetConfig("single-module");
  config.frontends = [
    {
      name: "web",
      repository: "app",
      path: "apps/web",
      connectsTo: ["api"],
      access: { mode: "authenticated" },
    },
  ] as never;
  config.endpoints.push({
    ...config.endpoints[0],
    method: "POST",
    operationId: "createNote",
    queryParams: [],
    pagination: undefined,
    requestBody: { useCase: { entity: "Note", operation: "create" } },
  });
  config.backends[0].authentication = {} as never;
  config.backends[0].authorization = {
    global: {
      roles: ["admin", "viewer"],
      adminRole: "admin",
      defaultRole: "viewer",
      mode: globalMode,
    },
    organizations: {
      roles: ["owner", "editor", "viewer"],
      ownerRole: "owner",
      defaultRole: "viewer",
      mode: organizationMode,
      rolePermissions: { editor: ["notes:read", "notes:write"], viewer: ["notes:read"] },
    },
  } as never;
  for (const endpoint of config.endpoints) {
    endpoint.authRequired = true;
    endpoint.scope = "organization";
    endpoint.permissions = [endpoint.method === "GET" ? "notes:read" : "notes:write"];
  }
  return config;
}
describe("scoped authorization generation", () => {
  it("preserves verified multi-role identity while the native session finishes hydration", () => {
    const files = generateFrontend(
      resolvedFixture(organizationFixture("multiple", "multiple")),
      "web",
    ).virtualFileSystem.snapshot();
    const initial = {
      id: "alice",
      role: "viewer",
      permissions: [],
      globalRoles: ["viewer"],
      globalPermissions: [],
      organizationId: "a",
      organizationRoles: ["a:owner"],
      organizationPermissions: ["*"],
    };
    let state: {
      isPending: boolean;
      data: { user: { id: string }; session: { activeOrganizationId: string } } | null;
    } = { isPending: true, data: null };
    const iamRequest = vi.fn(async () => initial);
    const load = frontendRuntime(files, "apps/web/src", {
      "@/lib/auth/client": { authClient: { useSession: () => state } },
      "@/lib/iam/client": { iamRequest },
      react: {
        createContext: () => ({}),
        createElement: () => null,
        useContext: () => initial,
        useRef: () => ({ current: false }),
        useState: (value: unknown) => [value, () => {}],
        useEffect: (effect: () => unknown) => {
          effect();
        },
      },
    });
    const view = load("@/lib/auth/use-session-view.ts").useSessionView as () => {
      user: unknown;
      isPending: boolean;
      hasPermission(permission: string, scope: string): boolean;
    };
    expect(view()).toMatchObject({ user: { id: "alice", organizationId: "a" }, isPending: false });
    state = {
      isPending: false,
      data: { user: { id: "alice" }, session: { activeOrganizationId: "a" } },
    };
    expect(view()).toMatchObject({ user: { id: "alice", organizationId: "a" }, isPending: false });
    expect(view().hasPermission("org:roles:manage", "organization")).toBe(true);
    expect(iamRequest).not.toHaveBeenCalled();
  });
  it.each([
    ["single", "single"],
    ["single", "multiple"],
    ["multiple", "single"],
    ["multiple", "multiple"],
  ] as const)(
    "compiles real global %s and organization %s authentication and schemas",
    async (globalMode, organizationMode) => {
      const output = generateBackend(
        resolvedFixture(organizationFixture(globalMode, organizationMode)),
        "api",
      );
      const files = Object.fromEntries(
        Object.entries(output.virtualFileSystem.snapshot()).filter(
          ([path]) =>
            path.endsWith(".ts") &&
            (path.includes("/platform/auth/") ||
              path.includes("/platform/audit/") ||
              path.includes("/platform/authorization/") ||
              path.includes("/platform/database/schema/") ||
              path.endsWith("/platform/database/drizzle-database.ts") ||
              path.includes("/domain/") ||
              path.includes("/infrastructure/database/schema/")),
        ),
      );
      expect(await generatedTypeErrors(files)).toEqual([]);
    },
    30000,
  );
  it("requires explicit protected scopes and rejects tenant entity global exposure", () => {
    const config = organizationFixture();
    config.endpoints[0].scope = undefined;
    expect(validateNordixConfig(config)).toMatchObject({
      success: false,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: "AUTHORIZATION_SCOPE_REQUIRED" }),
      ]),
    });
  });
  it.each([
    ["backends.0.authorization.global.roles", [], "AUTHORIZATION_ROLES_REQUIRED"],
    ["backends.0.authorization.global.defaultRole", "admin", "DEFAULT_ROLE_PRIVILEGED"],
    ["backends.0.authorization.global.defaultRole", "ghost", "DEFAULT_ROLE_UNKNOWN"],
    ["backends.0.authorization.global.adminRole", "ghost", "ADMIN_ROLE_UNKNOWN"],
    [
      "backends.0.authorization.global.rolePermissions.admin",
      [],
      "ADMIN_ROLE_PERMISSIONS_RESERVED",
    ],
    ["backends.0.authorization.global.rolePermissions.ghost", [], "ROLE_UNKNOWN"],
    ["backends.0.authorization.global.rolePermissions.viewer", ["*"], "PERMISSION_INVALID"],
    [
      "backends.0.authorization.global.rolePermissions.viewer",
      ["notes:read"],
      "PERMISSION_UNKNOWN",
    ],
    [
      "backends.0.authorization.organizations.rolePermissions.viewer",
      ["org:roles:manage"],
      "DEFAULT_ROLE_PRIVILEGED",
    ],
    [
      "backends.0.authorization.organizations.rolePermissions.editor",
      ["iam:roles:manage"],
      "PERMISSION_UNKNOWN",
    ],
    ["endpoints.0.scope", "global", "ORGANIZATION_ENTITY_SCOPE_REQUIRED"],
    ["endpoints.0.authRequired", false, "ORGANIZATION_SCOPE_INVALID"],
    ["entities.Note.fields.organizationId", { type: "string" }, "ORGANIZATION_FIELD_RESERVED"],
  ])("rejects unsafe authorization configuration at %s", (path, value, code) => {
    const config = organizationFixture();
    let target = config as unknown as Record<string, unknown>;
    const keys = path.split(".");
    for (const key of keys.slice(0, -1)) {
      target[key] ??= {};
      target = target[key] as Record<string, unknown>;
    }
    target[keys[keys.length - 1]] = value;
    expect(validateNordixConfig(config)).toMatchObject({
      success: false,
      diagnostics: expect.arrayContaining([expect.objectContaining({ code })]),
    });
  });
  it("defaults both omitted domains off and each present mode to single", () => {
    const config = organizationFixture();
    config.backends[0].authorization = undefined;
    for (const endpoint of config.endpoints) {
      endpoint.scope = undefined;
      endpoint.permissions = [];
    }
    const project = resolvedFixture(config);
    expect(project.backends.api.identity).toMatchObject({
      global: { enabled: false, mode: "single" },
      organizations: { enabled: false, mode: "single" },
    });
    const files = generateBackend(project, "api").virtualFileSystem.snapshot();
    expect(
      Object.keys(files).some(
        (path) => path.includes("organization-schema") || path.endsWith("/create-admin.ts"),
      ),
    ).toBe(false);
    expect(files["apps/api/src/platform/database/schema/auth-schema.ts"]).not.toContain("role:");
    config.backends[0].authorization = {} as never;
    expect(validateNordixConfig(config)).toMatchObject({
      success: false,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: "AUTHORIZATION_DOMAIN_REQUIRED" }),
      ]),
    });
    config.backends[0].authorization = {
      global: { roles: ["admin", "viewer"], adminRole: "admin", defaultRole: "viewer" },
    } as never;
    expect(resolvedFixture(config).backends.api.identity?.global).toMatchObject({
      enabled: true,
      mode: "single",
    });
    config.backends[0].authorization = {
      organizations: { roles: ["owner", "viewer"], ownerRole: "owner", defaultRole: "viewer" },
    } as never;
    for (const endpoint of config.endpoints) endpoint.scope = "organization";
    expect(resolvedFixture(config).backends.api.identity?.global.enabled).toBe(false);
  });
  it.each(["global-single", "global-multiple", "organization-single", "organization-multiple"])(
    "generates only the enabled %s domain and its frontend",
    async (scenario) => {
      const config = organizationFixture();
      const global = scenario.startsWith("global");
      const mode = scenario.endsWith("multiple") ? "multiple" : "single";
      config.backends[0].authorization = global
        ? ({
            global: {
              roles: ["admin", "viewer"],
              adminRole: "admin",
              defaultRole: "viewer",
              mode,
              rolePermissions: { viewer: ["notes:read"] },
            },
          } as never)
        : ({
            organizations: {
              roles: ["owner", "viewer"],
              ownerRole: "owner",
              defaultRole: "viewer",
              mode,
              rolePermissions: { viewer: ["notes:read"] },
            },
          } as never);
      for (const endpoint of config.endpoints) endpoint.scope = global ? "global" : "organization";
      const project = resolvedFixture(config);
      const files = generateBackend(project, "api").virtualFileSystem.snapshot();
      expect(
        await generatedTypeErrors(
          Object.fromEntries(Object.entries(files).filter(([name]) => name.endsWith(".ts"))),
        ),
      ).toEqual([]);
      const frontend = generateFrontend(project, "web").virtualFileSystem.snapshot();
      expect(Boolean(frontend["apps/web/src/app/admin/roles/page.tsx"])).toBe(global);
      expect(Boolean(frontend["apps/web/src/app/organization/settings/roles/page.tsx"])).toBe(
        !global,
      );
    },
    30000,
  );
  it("propagates ownership to related entities and rejects unscoped global permissions", () => {
    const config = organizationFixture();
    const note = config.entities.Note;
    config.entities.Child = {
      ...note,
      fields: { title: { type: "string" } },
      relations: {
        note: { type: "many-to-one", target: "Note", foreignKey: "noteId", required: true },
      },
    } as never;
    config.backends[0].modules.notes.entities.push("Child");
    const project = resolvedFixture(config);
    expect(project.entities.Child.scope).toBe("organization");
    config.endpoints[0].scope = "global";
    config.endpoints[1].scope = "global";
    config.backends[0].authorization = undefined;
    expect(validateNordixConfig(config)).toMatchObject({
      success: false,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: "GLOBAL_AUTHORIZATION_REQUIRED" }),
      ]),
    });
  });
  it("resolves each permission union with one SQL query and isolates contextual wildcards", async () => {
    const files = generateBackend(
      resolvedFixture(organizationFixture("multiple", "multiple")),
      "api",
    ).virtualFileSystem.snapshot();
    const execute = vi.fn(async () => ({
      rows: [
        {
          id: "u",
          global_roles: ["reader", "writer"],
          global_permissions: ["*"],
          organization_id: "a",
          organization_roles: ["a:viewer"],
          organization_permissions: ["notes:read"],
        },
      ],
    }));
    const load = generatedRuntime(files, { "drizzle-orm": await import("drizzle-orm") });
    const repository = (
      load("apps/api/src/platform/authorization/repository.ts").createIamRepository as (
        db: unknown,
      ) => { principal(id: string, org?: string): Promise<unknown> }
    )({ execute });
    const principal = await repository.principal("u", "a");
    expect(execute).toHaveBeenCalledTimes(1);
    const sql = new PgDialect().sqlToQuery(execute.mock.calls[0][0] as SQL);
    expect(sql.sql).toContain("LEFT JOIN LATERAL");
    expect(sql.params).toEqual(["a", "u"]);
    const policy = load("apps/api/src/platform/authorization/policy.ts") as {
      isAuthorized(principal: unknown, policy: unknown): boolean;
    };
    expect(
      policy.isAuthorized(principal, { scope: "organization", permissions: ["notes:read"] }),
    ).toBe(true);
    expect(
      policy.isAuthorized(principal, { scope: "organization", permissions: ["notes:write"] }),
    ).toBe(false);
    expect(
      policy.isAuthorized(
        { ...(principal as object), organizationId: undefined },
        { scope: "organization", permissions: [] },
      ),
    ).toBe(false);
  });
  it("partitions query caches by sorted roles, tenant and grants and compiles all tenant repositories", async () => {
    const config = organizationFixture("multiple", "multiple");
    const project = resolvedFixture(config);
    const files = generateBackend(project, "api").virtualFileSystem.snapshot();
    expect(
      await generatedTypeErrors(
        Object.fromEntries(Object.entries(files).filter(([path]) => path.endsWith(".ts"))),
      ),
    ).toEqual([]);
    const front = generateFrontend(project, "web").virtualFileSystem.snapshot();
    const source = front["apps/web/src/lib/api/cache.ts"];
    const cache = generatedRuntime(
      { "cache.ts": source },
      { "@tanstack/react-query": {} },
    )("cache.ts") as { privateQueryIdentity(user: unknown): unknown };
    const user = {
      id: "u",
      globalRoles: ["b", "a"],
      organizationId: "a",
      organizationRoles: ["y", "x"],
      globalPermissions: ["p"],
      organizationPermissions: ["q"],
    };
    expect(cache.privateQueryIdentity(user)).toEqual(
      cache.privateQueryIdentity({
        ...user,
        globalRoles: ["a", "b"],
        organizationRoles: ["x", "y"],
      }),
    );
    expect(cache.privateQueryIdentity(user)).not.toEqual(
      cache.privateQueryIdentity({ ...user, organizationId: "b" }),
    );
    expect(cache.privateQueryIdentity(user)).not.toEqual(
      cache.privateQueryIdentity({ ...user, organizationPermissions: [] }),
    );
  }, 30000);
});
