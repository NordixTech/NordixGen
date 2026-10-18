import { describe, expect, it } from "vitest";
import { NordixConfigSchema } from "../src/configuration/schema.js";
import { generateBackend } from "../src/generation/backend.js";
import { resolveCleanArchitectureLayout } from "../src/plugins/architecture/clean.js";
import { generateDomainFiles } from "../src/plugins/architecture/domain-files.js";
import type { BackendRenderContext, DomainModelContext } from "../src/plugins/contracts.js";
import { backendPaths } from "../src/plugins/frameworks/hono.js";
import { backendView } from "../src/project/views.js";
import { resolvedFixture } from "./fixtures.js";
import { createValidConfig } from "./fixtures.js";

function composeFixture(config = createValidConfig()) {
  return generateBackend(resolvedFixture(NordixConfigSchema.parse(config)), "core-api");
}

describe("Clean Architecture domain artifacts", () => {
  it("generates state-shaped domain entities, per-enum modules, and repository ports", () => {
    const config = createValidConfig();
    config.entities.Customer.fields.enabled = { type: "boolean", default: true };
    config.entities.Customer.fields.birthday = { type: "date", required: false };
    config.entities.Customer.fields.externalId = { type: "uuid" };
    config.entities.Customer.fields.profile = { type: "json", required: false };
    const result = composeFixture(config);
    expect(result.success).toBe(true);
    if (!result.success) return;

    const files = result.virtualFileSystem.snapshot();
    const user = files["apps/api-core/src/modules/commerce/domain/entities/Customer.entity.ts"];
    const order = files["apps/api-core/src/modules/commerce/domain/entities/Order.entity.ts"];
    const repository =
      files["apps/api-core/src/modules/commerce/application/ports/outbound/Order.repository.ts"];
    expect(user).toContain('import type { CustomerRole } from "./CustomerRole.enum.js";');
    expect(user).toContain('"email": string;');
    expect(user).toContain('"enabled": boolean;');
    expect(user).toContain('"birthday": Date | null;');
    expect(user).toContain('"externalId": string;');
    expect(user).toContain('"profile": unknown | null;');
    expect(user).toContain('"createdAt": Date;');
    expect(user).toContain('"deletedAt": Date | null;');
    expect(user).not.toContain("Metadata");
    expect(order).not.toContain('"customer": {');
    expect(
      files["apps/api-core/src/modules/commerce/domain/entities/OrderStatus.enum.ts"],
    ).toContain('export type OrderStatus = "PENDING" | "PAID";');
    expect(repository).toContain(
      'import type { Order, CreateOrderInput } from "../../../domain/entities/Order.entity.js";',
    );
    expect(repository).toContain("findById(id: string): Promise<Order | null>;");
    expect(repository).not.toMatch(/hono|drizzle/i);
    expect(user).not.toMatch(/hono|drizzle/i);
  });

  it("keeps generated output deterministic and scoped to its owning backend", () => {
    const config = createValidConfig();
    config.backends.push({
      name: "other-api",
      modules: { external: { architecture: "clean", entities: ["External"] } },
      repository: "commerce",
      path: "apps/other-api",
    });
    config.entities.External = { backend: "other-api", fields: { name: { type: "string" } } };
    const first = composeFixture(config);
    const second = composeFixture(config);
    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    if (!first.success || !second.success) return;

    expect(first.virtualFileSystem.snapshot()).toEqual(second.virtualFileSystem.snapshot());
    expect(Object.keys(first.virtualFileSystem.snapshot())).not.toContain(
      "apps/api-core/src/modules/commerce/domain/entities/External.entity.ts",
    );
  });

  it("uses a same-directory relative import when an architecture colocates its ports", () => {
    const { framework, architecture, domainModel } = createContributionContext(
      backendView(resolvedFixture(NordixConfigSchema.parse(createValidConfig())), "core-api"),
    );
    const colocatedContext: BackendRenderContext = {
      framework,
      architecture: {
        ...architecture,
        directories: {
          ...architecture.directories,
          outboundPort: architecture.directories.domainEntity,
        },
      },
      projectName: "test",
      domainModel,
    };
    const files = generateDomainFiles(colocatedContext);
    expect(files.find((file) => file.path.endsWith("Customer.repository.ts"))?.content).toContain(
      'from "./Customer.entity.js"',
    );
  });

  it("does not create an enum module when no enums are configured", () => {
    const { framework, architecture } = createContributionContext({
      enums: {},
      entities: {},
      endpoints: [],
    });
    const context: BackendRenderContext = {
      framework,
      architecture,
      projectName: "test",
      domainModel: { enums: {}, entities: {}, endpoints: [] },
    };
    expect(generateDomainFiles(context)).toEqual([]);
  });
});

function createContributionContext(domainModel: DomainModelContext) {
  const framework = backendPaths("apps/api-core");
  return {
    framework,
    architecture: resolveCleanArchitectureLayout(framework),
    domainModel,
    projectName: "test",
  };
}
