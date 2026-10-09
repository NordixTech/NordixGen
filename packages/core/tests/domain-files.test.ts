import { describe, expect, it } from "vitest";
import { NordixConfigSchema } from "../src/configuration/schema.js";
import { buildBackendDomainModel } from "../src/intermediate-representation.js";
import {
  cleanArchitecturePlugin,
  resolveCleanArchitectureLayout,
} from "../src/plugins/architecture/clean.js";
import { generateDomainFiles } from "../src/plugins/architecture/domain-files.js";
import { composeBackendPlugins } from "../src/plugins/composer.js";
import type { DomainModelContext, PluginContributionContext } from "../src/plugins/contracts.js";
import { honoFrameworkPlugin } from "../src/plugins/frameworks/hono.js";
import { drizzleOrmPlugin } from "../src/plugins/orms/drizzle.js";
import { PluginRegistry } from "../src/plugins/registry.js";
import { createValidConfig } from "./fixtures.js";

function composeFixture(config = createValidConfig()) {
  const registry = new PluginRegistry();
  registry.register(honoFrameworkPlugin);
  registry.register(cleanArchitecturePlugin);
  registry.register(drizzleOrmPlugin);
  return composeBackendPlugins(NordixConfigSchema.parse(config), "core-api", registry);
}

describe("Clean Architecture domain artifacts", () => {
  it("generates domain entities, enums, relation metadata, and repository ports", () => {
    const config = createValidConfig();
    config.entities.User.fields.enabled = { type: "boolean", default: true };
    config.entities.User.fields.birthday = { type: "date", required: false };
    config.entities.User.fields.externalId = { type: "uuid" };
    config.entities.User.fields.profile = { type: "json", required: false };
    config.entities.User.relations.teams = {
      type: "many-to-many",
      target: "Team",
      joinTable: "user_teams",
    };
    config.entities.Order.relations.receipt = {
      type: "one-to-one",
      target: "User",
      foreignKey: "order_id",
      onDelete: "set-null",
      required: true,
    };
    config.entities.Team = { backend: "core-api", fields: { name: { type: "string" } } };
    const result = composeFixture(config);
    expect(result.success).toBe(true);
    if (!result.success) return;

    const files = result.virtualFileSystem.snapshot();
    const user = files["apps/api-core/src/domain/entities/User.entity.ts"];
    const order = files["apps/api-core/src/domain/entities/Order.entity.ts"];
    const repository = files["apps/api-core/src/application/ports/outbound/Order.repository.ts"];
    expect(user).toContain('import type { UserRole } from "./enums.js";');
    expect(user).toContain('"email": string;');
    expect(user).toContain('"enabled": boolean;');
    expect(user).toContain('"birthday": Date | null;');
    expect(user).toContain('"externalId": string;');
    expect(user).toContain('"profile": unknown | null;');
    expect(user).toContain('"createdAt": Date;');
    expect(user).toContain('"deletedAt": Date | null;');
    expect(user).toContain('"unique": true');
    expect(user).toContain('"softDelete": "timestamp"');
    expect(order).toContain('"customer": {');
    expect(order).toContain('"onDelete": "restrict"');
    expect(order).toContain('"items": {');
    expect(order).toContain('"receipt": {');
    expect(order).toContain('"onDelete": "set-null"');
    expect(user).toContain('"joinTable": "user_teams"');
    expect(files["apps/api-core/src/domain/entities/enums.ts"]).toContain(
      'export type OrderStatus = "PENDING" | "PAID";',
    );
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
      framework: "hono",
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
      "apps/api-core/src/domain/entities/External.entity.ts",
    );
  });

  it("uses a same-directory relative import when an architecture colocates its ports", () => {
    const { framework, architecture, domainModel } = createContributionContext(
      buildBackendDomainModel(NordixConfigSchema.parse(createValidConfig()), "core-api"),
    );
    const colocatedContext: PluginContributionContext = {
      selection: { pluginId: "clean" },
      framework,
      architecture: {
        ...architecture,
        directories: {
          ...architecture.directories,
          outboundPort: architecture.directories.domainEntity,
        },
      },
      availableCapabilities: new Set(),
      domainModel,
    };
    const files = generateDomainFiles(colocatedContext);
    expect(files.find((file) => file.path.endsWith("User.repository.ts"))?.content).toContain(
      'from "./User.entity.js"',
    );
  });

  it("creates an empty enum module when no enums are configured", () => {
    const { framework, architecture } = createContributionContext({
      enums: {},
      entities: {},
      endpoints: [],
    });
    const context: PluginContributionContext = {
      selection: { pluginId: "clean" },
      framework,
      architecture,
      availableCapabilities: new Set(),
      domainModel: { enums: {}, entities: {}, endpoints: [] },
    };
    expect(generateDomainFiles(context)).toEqual([
      {
        path: "apps/api-core/src/domain/entities/enums.ts",
        content: "export {};\n",
      },
    ]);
  });

  it("rejects an entity name with no corresponding normalized entity", () => {
    const { framework, architecture } = createContributionContext({
      enums: {},
      entities: {},
    });
    expect(() =>
      generateDomainFiles({
        selection: { pluginId: "clean" },
        framework,
        architecture,
        availableCapabilities: new Set(),
        domainModel: {
          enums: {},
          endpoints: [],
          entities: new Proxy(
            {},
            {
              ownKeys: () => ["Missing"],
              get: () => undefined,
              getOwnPropertyDescriptor: () => ({ configurable: true, enumerable: true }),
            },
          ) as DomainModelContext["entities"],
        },
      }),
    ).toThrow('Domain model is missing entity "Missing".');
  });
});

function createContributionContext(domainModel: DomainModelContext) {
  const selection = {
    pluginId: "hono",
    configuration: { applicationRoot: "apps/api-core" },
  };
  const framework = honoFrameworkPlugin.createFrameworkContext?.(selection);
  if (!framework) throw new Error("Hono framework context is unavailable.");
  return {
    framework,
    architecture: resolveCleanArchitectureLayout(framework),
    domainModel,
  };
}
