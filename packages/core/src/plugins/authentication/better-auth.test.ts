import ts from "typescript";
import { describe, expect, it } from "vitest";
import { parseNordixYaml } from "../../configuration/validate.js";
import { cleanArchitecturePlugin } from "../architecture/clean.js";
import { rbacPbacPlugin } from "../authorization/rbac-pbac.js";
import { composeBackendPlugins } from "../composer.js";
import type { PluginContributionContext } from "../contracts.js";
import { honoFrameworkPlugin } from "../frameworks/hono.js";
import { drizzleOrmPlugin } from "../orms/drizzle.js";
import { PluginRegistry } from "../registry.js";
import { betterAuthPlugin } from "./better-auth.js";

function compose(features: string[] = [], methods = ["email-password"], providers: string[] = []) {
  const parsed = parseNordixYaml(`
name: auth-test
version: 1.0.0
repositories:
  - name: workspace
    path: .
backends:
  - name: api
    framework: hono
    architecture: clean
    repository: workspace
    path: apps/api
    persistence:
      database: primary
      orm: drizzle
    authentication:
      plugin: better-auth
      methods: [${methods.join(", ")}]
      identityProviders: [${providers.join(", ")}]
      features: [${features.join(", ")}]
    authorization:
      roles: [admin, customer]
      defaultRole: customer
      rolePermissions:
        admin: ["*"]
        customer: [orders:read]
databases:
  primary:
    engine: postgres
    provider: neon
entities:
  Order:
    backend: api
    fields:
      status: { type: string }
endpoints:
  - backend: api
    method: GET
    path: /api/orders
    operationId: listOrders
    entity: Order
    roles: [admin]
    permissions: [orders:read]
`);
  if (!parsed.success) throw new Error(JSON.stringify(parsed.diagnostics));

  const registry = new PluginRegistry();
  for (const plugin of [
    cleanArchitecturePlugin,
    honoFrameworkPlugin,
    drizzleOrmPlugin,
    betterAuthPlugin,
    rbacPbacPlugin,
  ])
    registry.register(plugin);

  return composeBackendPlugins(parsed.config, "api", registry);
}

describe("Better Auth plugin composition", () => {
  it("generates the default credential flow and protects generated CRUD routes", () => {
    const result = compose();
    expect(result.success).toBe(true);
    if (!result.success) return;

    const files = result.virtualFileSystem.snapshot();
    expect(files["apps/api/src/infrastructure/auth/auth.ts"]).toContain("minPasswordLength: 15");
    expect(files["apps/api/src/infrastructure/database/schema/index.ts"]).toContain(
      'export * from "./auth-schema.js";',
    );
    expect(files["apps/api/src/presentation/controllers/order.controller.ts"]).toContain(
      "Authentication is required",
    );
    expect(files["apps/api/src/presentation/controllers/order.controller.ts"]).toContain(
      "A trusted Origin header is required for state-changing requests",
    );
    expect(files["apps/api/src/presentation/controllers/listOrders.controller.ts"]).toContain(
      "isAuthorized(session.user",
    );
    expect(files["apps/api/src/index.ts"]).toContain('app.all("/api/auth/*"');
  });

  it("generates optional username, provider, email, and two-factor support", () => {
    const result = compose(
      ["email-verification", "password-recovery", "two-factor"],
      ["email-password", "username-password"],
      ["google", "github"],
    );
    expect(result.success).toBe(true);
    if (!result.success) return;

    const auth = result.virtualFileSystem.readFile("apps/api/src/infrastructure/auth/auth.ts");
    const schema = result.virtualFileSystem.readFile(
      "apps/api/src/infrastructure/database/schema/auth-schema.ts",
    );
    expect(auth).toContain('import { username } from "better-auth/plugins";');
    expect(auth).toContain('import { twoFactor } from "better-auth/plugins";');
    expect(auth).toContain("queueAuthEmail(user.email");
    expect(auth).toContain("google: { clientId:");
    expect(auth).toContain("github: { clientId:");
    expect(auth).toContain("executionContext.waitUntil");
    expect(auth).toContain("getTrustedAuthOrigins(env)");
    expect(schema).toContain('username: text("username").unique()');
    expect(schema).toContain('twoFactorEnabled: boolean("two_factor_enabled")');
    expect(schema).toContain('export const twoFactor = pgTable("twoFactor"');
  });

  it("executes generated role and permission policies", async () => {
    const result = compose();
    expect(result.success).toBe(true);
    if (!result.success) return;

    const policySource = result.virtualFileSystem.readFile(
      "apps/api/src/infrastructure/authorization/policy.ts",
    );
    if (!policySource) throw new Error("Authorization policy was not generated.");
    const javascript = ts.transpileModule(policySource, {
      compilerOptions: { module: ts.ModuleKind.ESNext },
    }).outputText;
    const policy = await import(
      `data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`
    );

    expect(
      policy.isAuthorized({ role: "admin" }, { roles: ["admin"], permissions: ["orders:delete"] }),
    ).toBe(true);
    expect(
      policy.isAuthorized(
        { role: "customer" },
        { roles: ["customer"], permissions: ["orders:read"] },
      ),
    ).toBe(true);
    expect(policy.isAuthorized({ role: "customer" }, { roles: ["admin"], permissions: [] })).toBe(
      false,
    );
    expect(
      policy.isAuthorized({ role: "customer" }, { roles: [], permissions: ["orders:delete"] }),
    ).toBe(false);
    expect(policy.isAuthorized({}, { roles: [], permissions: [] })).toBe(true);
  });

  it("rejects unsupported PIN authentication before plugin composition", () => {
    const parsed = parseNordixYaml(`
name: pin-test
version: 1.0.0
repositories: [{ name: workspace, path: . }]
backends:
  - name: api
    framework: hono
    repository: workspace
    path: apps/api
    authentication: { plugin: better-auth, methods: [pin] }
entities:
  User: { backend: api, fields: {} }
`);
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.diagnostics.map(({ message }) => message).join(" ")).toContain(
      "PIN authentication is unsupported",
    );
  });

  it("fails explicitly when either security plugin receives no validated configuration", () => {
    const missingAuthConfiguration = {
      selection: { pluginId: "better-auth", configuration: null },
    } as unknown as PluginContributionContext;
    expect(() => betterAuthPlugin.contribute(missingAuthConfiguration)).toThrow(
      "Better Auth requires its validated backend authentication configuration.",
    );

    const missingPolicyConfiguration = {
      selection: { pluginId: "rbac-pbac", configuration: {} },
    } as unknown as PluginContributionContext;
    expect(() => rbacPbacPlugin.contribute(missingPolicyConfiguration)).toThrow(
      "RBAC/PBAC requires validated authorization roles and permission grants.",
    );
  });

  it("uses secure defaults for partial direct plugin configuration and requires persistence", () => {
    const context = {
      selection: { pluginId: "better-auth", configuration: {} },
      framework: { codeRoot: "apps/api/src" },
      architecture: { directories: { infrastructure: "infrastructure" } },
      availableCapabilities: new Set<string>(),
      persistence: {
        directories: {
          infrastructure: "apps/api/src/infrastructure",
          adapter: "apps/api/src/infrastructure/adapters",
        },
      },
    } as unknown as PluginContributionContext;
    const generated = betterAuthPlugin.contribute(context);
    expect(generated[0]?.content).toContain('.default("user")');
    expect(generated[1]?.content).toContain("enabled: true");
    expect(generated[2]?.content).not.toContain("RESEND_API_KEY");
    const sameDirectoryImport = betterAuthPlugin.contribute({
      ...context,
      persistence: {
        directories: {
          infrastructure: "apps/api/src/infrastructure",
          adapter: "apps/api/src/infrastructure/auth",
        },
      },
    });
    expect(sameDirectoryImport[1]?.content).toContain('from "./drizzle-database.js"');

    expect(() => betterAuthPlugin.contribute({ ...context, persistence: undefined })).toThrow(
      "Better Auth requires a persistence context.",
    );

    const policyContext = {
      selection: { pluginId: "rbac-pbac", configuration: { authorization: { roles: [] } } },
      framework: context.framework,
      architecture: context.architecture,
      availableCapabilities: new Set<string>(),
    } as unknown as PluginContributionContext;
    expect(rbacPbacPlugin.contribute(policyContext)[0]?.content).toContain("rolePermissions");
  });
});
