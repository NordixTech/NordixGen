import { readFileSync } from "node:fs";
import { stringify } from "yaml";
import { parseNordixYaml } from "../src/configuration/validate.js";
import { formatDiagnostic } from "../src/diagnostics.js";
import { resolveProject } from "../src/project/resolve.js";

export function createValidConfig() {
  return {
    name: "sample-commerce",
    version: "1.0.0",
    organizations: [
      {
        name: "nordix",
        handle: "NordixTech",
      },
    ],
    repositories: [
      {
        name: "commerce",
        path: ".",
        organization: "nordix",
        initializeGit: true,
      },
    ],
    frontends: [
      {
        name: "store-web",
        path: "apps/store-web",
        repository: "commerce",
        connectsTo: ["core-api"],
        access: {
          mode: "public",
        },
      },
    ],
    backends: [
      {
        name: "core-api",
        repository: "commerce",
        path: "apps/api-core",
        persistence: {
          database: "commerce-db",
        },
        modules: {
          commerce: {
            architecture: "clean",
            entities: ["Customer", "Order", "OrderItem"],
          },
        },
      },
    ],
    databases: {
      "commerce-db": {},
    },
    enums: {
      OrderStatus: ["PENDING", "PAID"],
      CustomerRole: ["ADMIN", "CUSTOMER"],
    },
    entities: {
      Customer: {
        backend: "core-api",
        fields: {
          email: {
            type: "string",
            unique: true,
          },
          role: {
            type: "enum",
            enumName: "CustomerRole",
            default: "CUSTOMER",
          },
        },
        relations: {},
        timestamps: {
          createdAt: true,
          updatedAt: true,
        },
        softDelete: "timestamp",
      },
      Order: {
        backend: "core-api",
        fields: {
          status: {
            type: "enum",
            enumName: "OrderStatus",
            default: "PENDING",
          },
          total: {
            type: "number",
            default: 10.5,
          },
        },
        relations: {
          customer: {
            type: "many-to-one",
            target: "Customer",
            foreignKey: "customer_id",
            onDelete: "restrict",
          },
          items: {
            type: "one-to-many",
            target: "OrderItem",
            foreignKey: "order_id",
          },
        },
        timestamps: {
          createdAt: true,
          updatedAt: true,
        },
        softDelete: "boolean",
      },
      OrderItem: {
        backend: "core-api",
        fields: {
          quantity: {
            type: "number",
            default: 1,
          },
          note: {
            type: "string",
            required: false,
          },
        },
        relations: {
          order: {
            type: "many-to-one",
            target: "Order",
            foreignKey: "order_id",
            onDelete: "cascade",
          },
        },
        timestamps: {
          createdAt: true,
          updatedAt: false,
        },
        softDelete: false,
      },
    },
    endpoints: [
      {
        path: "/api/orders/summary",
        method: "GET",
        operationId: "getOrderSummary",
        backend: "core-api",
        entity: "Order",
        authRequired: false,
        roles: [],
        queryParams: [
          {
            name: "status",
            field: {
              entity: "Order",
              field: "status",
            },
            required: false,
          },
        ],
        pagination: "standard",
        joins: [
          {
            entity: "Customer",
            type: "inner",
            fields: ["id", "email"],
          },
          {
            entity: "OrderItem",
            type: "left",
            fields: ["quantity"],
          },
        ],
      },
    ],
    pagination: {
      standard: {
        strategy: "offset",
        defaultPageSize: 20,
        maxPageSize: 80,
      },
    },
    schemaVersion: 2,
  };
}
export const comprehensiveYaml = stringify(createValidConfig());

export function targetConfig(name = "clean-modules") {
  const result = parseNordixYaml(
    readFileSync(new URL(`../../../examples/configuration/${name}.yaml`, import.meta.url), "utf8"),
  );
  if (!result.success) throw new Error(JSON.stringify(result.diagnostics));
  return result.config;
}

export function resolvedFixture(input: unknown = createValidConfig()) {
  const result = resolveProject(input);
  if (!result.success) throw new Error(result.diagnostics.map(formatDiagnostic).join("\n"));
  return result.project;
}

export function createSecuredConfig() {
  const config = createValidConfig();
  Object.assign(config.backends[0], {
    authentication: {},
    authorization: {
      roles: ["admin", "viewer"],
      adminRole: "admin",
      defaultRole: "viewer",
      rolePermissions: { viewer: [] },
    },
  });
  return config;
}
