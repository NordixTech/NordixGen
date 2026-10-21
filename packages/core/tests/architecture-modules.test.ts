import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { generateBackend } from "../src/generation/backend.js";
import { resolveArchitectureLayout } from "../src/plugins/architecture/layout.js";
import { resolvedFixture, targetConfig } from "./fixtures.js";
import { generatedTypeErrors } from "./generated-types.js";
import { constrainedPersistenceFixture } from "./persistence-fixture.js";

describe.each(["hexagonal", "onion"] as const)("%s executable architecture", (architecture) => {
  it("compiles persisted reads, writes, relations, defaults and an audited operation alongside Clean", async () => {
    const config = constrainedPersistenceFixture();
    config.backends[0].modules.billing.architecture = architecture;
    const operation = config.endpoints.find((endpoint) => endpoint.operationId === "createInvoice");
    if (!operation) throw Error("Missing create operation");
    operation.audit = true;
    const result = generateBackend(resolvedFixture(config), "api");
    if (!result.success) throw Error(JSON.stringify(result.diagnostics));
    const sources = Object.fromEntries(
      Object.entries(result.virtualFileSystem.snapshot())
        .filter(([name]) => name.endsWith(".ts"))
        .map(([name, source]) => [name.slice("apps/api/".length), source]),
    );
    expect(await generatedTypeErrors(sources)).toEqual([]);
    const layout = resolveArchitectureLayout(architecture);
    expect(sources[`src/modules/billing/${layout.inboundPort}/CreateInvoice.port.ts`]).toContain(
      "execute(input:unknown",
    );
    expect(
      sources[`src/modules/billing/${layout.directories.useCase}/CreateInvoice.use-case.ts`],
    ).toContain("implements CreateInvoicePort");
    expect(
      sources[`src/modules/billing/${layout.directories.controller}/createInvoice.controller.ts`],
    ).toContain("useCase?: CreateInvoicePort");
  }, 30_000);

  it("enforces core, domain, module privacy and adapter boundaries in emitted source", async () => {
    const config = targetConfig();
    config.backends[0].modules.billing.architecture = architecture;
    const moduleName = architecture === "hexagonal" ? "adapters" : "public";
    config.backends[0].modules[moduleName] = config.backends[0].modules.billing;
    Reflect.deleteProperty(config.backends[0].modules, "billing");
    const output = generateBackend(resolvedFixture(config), "api");
    if (!output.success) throw Error("Invalid architecture fixture");
    const parent = fileURLToPath(new URL("../", import.meta.url));
    const directory = await mkdtemp(join(parent, ".nordixgen-contract-types-"));
    try {
      await output.virtualFileSystem.emit(directory);
      const app = join(directory, "apps/api");
      const script = join(app, "scripts/check-boundaries.mjs");
      const run = () =>
        execFileSync(process.execPath, [script], { cwd: app, encoding: "utf8", stdio: "pipe" });
      expect(run()).toContain("boundaries passed");
      const layout = resolveArchitectureLayout(architecture);
      const moduleRoot = `src/modules/${moduleName}`;
      const appFile = `${moduleRoot}/${layout.applicationRoot}/bad.ts`;
      const domainFile = `${moduleRoot}/${layout.domainRoot}/bad.ts`;
      const relative = (file: string, target: string) =>
        posix.relative(posix.dirname(file), target);
      const violations = [
        [appFile, 'import {Hono} from "hono";', "ARCHITECTURE_DEPENDENCY_INVALID"],
        [appFile, 'import type {SQL} from "drizzle-orm";', "ARCHITECTURE_DEPENDENCY_INVALID"],
        [
          appFile,
          `await import("${relative(appFile, `${moduleRoot}/${layout.databaseClient}`)}");`,
          "ARCHITECTURE_DEPENDENCY_INVALID",
        ],
        [
          appFile,
          `import {createModule} from "${relative(appFile, `${moduleRoot}/bootstrap.js`)}";`,
          "ARCHITECTURE_DEPENDENCY_INVALID",
        ],
        [
          domainFile,
          `export * from "${relative(domainFile, `${moduleRoot}/${layout.applicationRoot}/operation-contracts.js`)}";`,
          "ARCHITECTURE_DEPENDENCY_INVALID",
        ],
        [
          domainFile,
          `import type {GetCustomerInput} from "${relative(domainFile, "src/modules/customers/index.js")}";`,
          "ARCHITECTURE_DEPENDENCY_INVALID",
        ],
        [
          appFile,
          `import "${relative(appFile, "src/modules/customers/domain/entities/Customer.entity.js")}";`,
          "MODULE_PRIVATE_IMPORT",
        ],
        [
          `${moduleRoot}/public/leak.ts`,
          'export * from "../bootstrap.js";',
          "MODULE_PRIVATE_EXPORT",
        ],
      ];
      if (architecture === "hexagonal") {
        const controller = `${moduleRoot}/${layout.directories.controller}/bad.ts`;
        violations.push([
          controller,
          `import "${relative(controller, `${moduleRoot}/${layout.directories.adapter}/ListInvoices.drizzle.query.adapter.js`)}";`,
          "ARCHITECTURE_DEPENDENCY_INVALID",
        ]);
      }
      for (const [file, source, code] of violations) {
        const path = join(app, file);
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, source);
        expect(() => run()).toThrow(code);
        await rm(path);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);

  it("compiles without persistence or identity", async () => {
    const config = targetConfig("single-module");
    config.backends[0].modules.notes.architecture = architecture;
    config.backends[0].persistence = undefined;
    config.endpoints = [];
    const result = generateBackend(resolvedFixture(config), "api");
    if (!result.success) throw Error("Invalid domain-only fixture");
    expect(
      await generatedTypeErrors(
        Object.fromEntries(
          Object.entries(result.virtualFileSystem.snapshot())
            .filter(([name]) => name.endsWith(".ts"))
            .map(([name, source]) => [name.slice("apps/api/".length), source]),
        ),
      ),
    ).toEqual([]);
  }, 20_000);
});

it("compiles Clean, Hexagonal and Onion together with one backend composition and schema", async () => {
  const output = generateBackend(resolvedFixture(targetConfig("mixed-modules")), "api");
  if (!output.success) throw Error("Mixed families must be generation-ready");
  const files = output.virtualFileSystem.snapshot();
  expect(
    await generatedTypeErrors(
      Object.fromEntries(
        Object.entries(files)
          .filter(([name]) => name.endsWith(".ts"))
          .map(([name, source]) => [name.slice("apps/api/".length), source]),
      ),
    ),
  ).toEqual([]);
  expect(Object.keys(files).filter((name) => name.endsWith("/auth.ts"))).toHaveLength(1);
  expect(Object.keys(files).filter((name) => name.endsWith("/drizzle-database.ts"))).toHaveLength(
    1,
  );
  expect(files["apps/api/src/platform/database/create-route-dependencies.ts"]).toContain(
    "module2(db,",
  );
}, 30_000);
