import ts from "typescript";
import { describe, expect, it } from "vitest";
import { resolvedFixture } from "../../../tests/fixtures.js";
import { parseNordixYaml } from "../../configuration/validate.js";
import { generateBackend } from "../../generation/backend.js";
import type { BackendRenderContext } from "../contracts.js";

function compose(features: string[] = [], methods = ["email-password"], providers: string[] = []) {
  const parsed = parseNordixYaml(`
name: auth-test
version: 1.0.0
schemaVersion: 2
repositories:
  - name: workspace
    path: .
backends:
  - name: api
    repository: workspace
    path: apps/api
    modules:
      business:
        architecture: clean
        entities: [Order]
    persistence:
      database: primary
    authentication:
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
  primary: {}
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

  return generateBackend(resolvedFixture(parsed.config), "api");
}

describe("Better Auth plugin composition", () => {
  it("generates the default credential flow and protects declared business routes", () => {
    const result = compose();
    expect(result.success).toBe(true);
    if (!result.success) return;

    const files = result.virtualFileSystem.snapshot();
    expect(files["apps/api/src/infrastructure/auth/auth.ts"]).toContain("minPasswordLength: 4");
    expect(files["apps/api/src/infrastructure/database/schema/index.ts"]).toContain(
      'export * from "./auth-schema.js";',
    );
    expect(files["apps/api/src/presentation/controllers/listOrders.controller.ts"]).toContain(
      "Authentication is required",
    );
    expect(files["apps/api/src/presentation/controllers/listOrders.controller.ts"]).toContain(
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
    for (const role of ["constructor", "toString", "hasOwnProperty"])
      expect(policy.isAuthorized({ role }, { roles: [], permissions: ["orders:read"] })).toBe(
        false,
      );
  });

  it("rejects unsupported PIN authentication before plugin composition", () => {
    const parsed = parseNordixYaml(`
name: pin-test
version: 1.0.0
schemaVersion: 2
repositories: [{ name: workspace, path: . }]
backends:
  - name: api
    repository: workspace
    path: apps/api
    authentication: { methods: [pin] }
entities:
  User: { backend: api, fields: {} }
`);
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.diagnostics.map(({ message }) => message).join(" ")).toContain(
      "email-password, username-password",
    );
  });
});
