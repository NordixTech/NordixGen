import { describe, expect, it } from "vitest";
import type { NordixConfig } from "../src/configuration/schema.js";
import { validateNordixConfig } from "../src/configuration/validate.js";
import { targetConfig } from "./fixtures.js";

describe("backend identity policies and frontend access validation", () => {
  const cases: [string, (c: NordixConfig) => void, string][] = [
    [
      "public operation with grants",
      (c) => {
        c.endpoints[1].authRequired = false;
      },
      "ACCESS_POLICY_CONFLICT",
    ],
    [
      "unknown endpoint role",
      (c) => {
        c.endpoints[1].roles = ["ghost"];
      },
      "ROLE_UNKNOWN",
    ],
    [
      "unknown endpoint permission",
      (c) => {
        c.endpoints[1].permissions = ["customers:missing"];
      },
      "PERMISSION_UNKNOWN",
    ],
    [
      "wildcard permission request",
      (c) => {
        c.endpoints[1].permissions = ["*"];
      },
      "PERMISSION_UNKNOWN",
    ],
    [
      "unknown default role",
      (c) => {
        c.backends[0].authorization.defaultRole = "ghost";
      },
      "DEFAULT_ROLE_UNKNOWN",
    ],
    [
      "unknown grant owner",
      (c) => {
        c.backends[0].authorization.rolePermissions.ghost = ["customers:read"];
      },
      "ROLE_UNKNOWN",
    ],
    [
      "partial wildcard grant",
      (c) => {
        c.backends[0].authorization.rolePermissions.admin = ["customers:*"];
      },
      "PERMISSION_INVALID",
    ],
    [
      "disabled identity with authorization",
      (c) => {
        c.backends[0].authentication = undefined;
      },
      "AUTHENTICATION_REQUIRED",
    ],
    [
      "username without email credentials",
      (c) => {
        c.backends[0].authentication.methods = ["username-password"];
      },
      "AUTHENTICATION_METHOD_INVALID",
    ],
    [
      "unknown identity selection",
      (c) => {
        c.frontends[0].access.backend = "ghost";
      },
      "FRONTEND_IDENTITY_INVALID",
    ],
    [
      "protected frontend without identity",
      (c) => {
        c.backends[0].authentication = undefined;
        c.frontends[0].access.backend = undefined;
      },
      "FRONTEND_IDENTITY_REQUIRED",
    ],
    [
      "unknown public page",
      (c) => {
        c.frontends[0].access.publicRoutes = ["/missing-page"];
      },
      "FRONTEND_ACCESS_ROUTE_INVALID",
    ],
    [
      "mixed whole-site wildcard",
      (c) => {
        c.frontends[0].access.publicRoutes = ["/**"];
      },
      "FRONTEND_ACCESS_ROUTE_INVALID",
    ],
    [
      "mixed empty rules",
      (c) => {
        c.frontends[0].access.publicRoutes = [];
      },
      "FRONTEND_ACCESS_ROUTE_INVALID",
    ],
    [
      "rules on public mode",
      (c) => {
        c.frontends[0].access.mode = "public";
      },
      "FRONTEND_ACCESS_ROUTE_INVALID",
    ],
    [
      "redundant subtree",
      (c) => {
        c.frontends[0].access.publicRoutes = ["/customer", "/customer/**"];
      },
      "FRONTEND_ACCESS_ROUTE_INVALID",
    ],
    [
      "explicit authentication page rule",
      (c) => {
        c.frontends[0].access.publicRoutes = ["/sign-in"];
      },
      "FRONTEND_ACCESS_ROUTE_INVALID",
    ],
  ];
  it.each(cases)("rejects %s", (_name, mutate, code) => {
    const config = targetConfig();
    mutate(config);
    expect(validateNordixConfig(config).diagnostics).toContainEqual(
      expect.objectContaining({ code }),
    );
  });

  it("rejects ambiguous authorities and secured operations under another identity", () => {
    const config = targetConfig();
    config.backends.push({
      ...structuredClone(config.backends[0]),
      name: "other",
      path: "apps/other",
      modules: { other: { architecture: "clean", entities: ["Other"], exports: [], imports: {} } },
    });
    config.entities.Other = { ...structuredClone(config.entities.Invoice), backend: "other" };
    config.endpoints.push({
      ...structuredClone(config.endpoints.find((e) => e.operationId === "listInvoices")),
      backend: "other",
      entity: "Other",
      operationId: "listOther",
      authRequired: true,
    });
    config.frontends[0].connectsTo.push("other");
    config.frontends[0].access.backend = undefined;
    expect(validateNordixConfig(config).diagnostics).toContainEqual(
      expect.objectContaining({ code: "FRONTEND_IDENTITY_AMBIGUOUS" }),
    );
    config.frontends[0].access.backend = "api";
    expect(validateNordixConfig(config).diagnostics).toContainEqual(
      expect.objectContaining({ code: "FRONTEND_IDENTITY_MISMATCH" }),
    );
    config.endpoints.at(-1).authRequired = false;
    config.endpoints.at(-1).permissions = [];
    expect(
      validateNordixConfig(config).diagnostics.some((d) => d.code === "FRONTEND_IDENTITY_MISMATCH"),
    ).toBe(false);
  });

  it("supports public frontends without identity and nonredundant exact/subtree public rules", () => {
    const config = targetConfig();
    config.frontends[0].access.publicRoutes = ["/", "/customer/**"];
    expect(validateNordixConfig(config).success).toBe(true);
    const publicConfig = targetConfig("single-module");
    publicConfig.frontends = [
      {
        name: "web",
        path: "apps/web",
        repository: "app",
        connectsTo: ["api"],
        access: { mode: "public" },
      },
    ];
    expect(validateNordixConfig(publicConfig).success).toBe(true);
  });
  it("rejects frontend exports that collide after backend qualification", () => {
    const config = targetConfig("single-module");
    const backend = config.backends[0];
    config.backends.push({
      ...structuredClone(backend),
      name: "other",
      path: "apps/other",
      modules: { other: { architecture: "clean", entities: ["Other"], exports: [], imports: {} } },
    });
    config.entities.Other = { ...structuredClone(config.entities.Note), backend: "other" };
    const endpoint = config.endpoints[0];
    endpoint.operationId = "listNotes";
    config.endpoints.push(
      { ...structuredClone(endpoint), backend: "other", entity: "Other" },
      { ...structuredClone(endpoint), operationId: "apiListNotes", path: "/other-path" },
    );
    config.frontends = [
      {
        name: "web",
        repository: "app",
        path: "apps/web",
        connectsTo: ["api", "other"],
        access: { mode: "public" },
      },
    ];
    expect(validateNordixConfig(config).diagnostics).toContainEqual(
      expect.objectContaining({
        code: "GENERATED_NAME_COLLISION",
        path: "frontends[0].connectsTo",
        message: expect.stringContaining("apiListNotes"),
      }),
    );
  });
});
