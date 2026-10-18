import { describe, expect, it } from "vitest";
import { generateBackend } from "../src/generation/backend.js";
import { resolvedFixture, targetConfig } from "./fixtures.js";

describe("operation-driven backend output", () => {
  it.each(["none", "read-only", "named-mutations"] as const)(
    "generates exactly the declared use cases and persistence ports: %s",
    (mode) => {
      const config = targetConfig();
      config.frontends = [];
      for (const businessModule of Object.values(config.backends[0].modules)) {
        businessModule.exports = [];
        businessModule.imports = {};
      }
      config.endpoints = mode === "none" ? [] : config.endpoints.filter((e) => e.method === "GET");
      const known = new Set(config.endpoints.flatMap((endpoint) => endpoint.permissions));
      for (const [role, grants] of Object.entries(config.backends[0].authorization.rolePermissions))
        config.backends[0].authorization.rolePermissions[role] = grants.filter(
          (permission) => permission === "*" || known.has(permission),
        );
      if (mode === "named-mutations") {
        config.endpoints.push(
          {
            backend: "api",
            entity: "Invoice",
            operationId: "registerInvoice",
            method: "POST",
            path: "/api/invoices",
            authRequired: true,
            roles: [],
            permissions: [],
            pathParams: [],
            queryParams: [],
            joins: [],
            requestBody: { useCase: { entity: "Invoice", operation: "create" } },
          },
          {
            backend: "api",
            entity: "Invoice",
            operationId: "removeInvoice",
            method: "DELETE",
            path: "/api/invoices/{invoiceId}",
            authRequired: true,
            roles: [],
            permissions: [],
            queryParams: [],
            joins: [],
            pathParams: [
              { name: "invoiceId", field: { entity: "Invoice", field: "id" }, required: true },
            ],
          },
        );
      }
      const project = resolvedFixture(config);
      const result = generateBackend(project, "api");
      if (!result.success) throw Error(JSON.stringify(result.diagnostics));
      const files = result.virtualFileSystem.snapshot();
      const paths = Object.keys(files);
      const expected = Object.values(project.operations).map((operation) => ({
        root: `apps/api/src/modules/${project.modules[operation.moduleId].name}`,
        name: operation.typeName,
      }));
      expect(
        paths.filter((p) => /\/application\/use-cases\/[^/]+\.use-case\.ts$/.test(p)).sort(),
      ).toEqual(
        expected.map((e) => `${e.root}/application/use-cases/${e.name}.use-case.ts`).sort(),
      );
      expect(paths.filter((p) => p.endsWith(".query.port.ts")).sort()).toEqual(
        expected.map((e) => `${e.root}/application/ports/outbound/${e.name}.query.port.ts`).sort(),
      );
      expect(paths.filter((p) => p.endsWith(".drizzle.query.adapter.ts")).sort()).toEqual(
        expected
          .map((e) => `${e.root}/infrastructure/adapters/${e.name}.drizzle.query.adapter.ts`)
          .sort(),
      );
      expect(paths.filter((p) => p.endsWith(".repository.ts"))).toEqual([]);
      expect(paths.filter((p) => /\/use-cases\/[^/]+\/[^/]+\.use-case\.ts$/.test(p))).toEqual([]);
      for (const entity of Object.values(project.entities)) {
        const root = `apps/api/src/modules/${project.modules[entity.moduleId].name}`;
        expect(files[`${root}/domain/entities/${entity.name}.entity.ts`]).toBeDefined();
        expect(
          files[`${root}/infrastructure/database/schema/${entity.name}.table.ts`],
        ).toBeDefined();
      }
      const responseSchemas = paths.filter((p) => /\/use-cases\/dtos\/[^/]+\.dto\.ts$/.test(p));
      for (const path of responseSchemas)
        expect(files[path]).not.toMatch(/export const (Create|Update|List)\w+Schema|IdSchema/);
      if (mode === "none") {
        expect(responseSchemas).toEqual([]);
        expect(
          paths.filter((p) => p.endsWith("clock.port.ts") || p.endsWith("system-clock.adapter.ts")),
        ).toEqual([]);
      }
    },
  );
});
