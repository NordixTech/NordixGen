export function createValidConfig() {
  return {
    name: "sample-commerce",
    version: "1.0.0",
    frontends: [
      {
        name: "store-web",
        framework: "nextjs",
        path: "apps/store-web",
        connectsTo: "core-api",
        stateManagement: {
          client: "zustand",
          server: "tanstack-query",
          generateHooks: true,
          optimisticUpdates: true,
        },
      },
    ],
    backends: [
      {
        name: "core-api",
        framework: "hono",
        path: "apps/api-core",
        auth: {
          type: "jwt",
          providers: ["credentials"],
          roles: ["admin", "customer"],
          permissions: ["orders:read"],
        },
      },
    ],
    database: { engine: "postgres", provider: "neon", orm: "drizzle" },
    deployment: { provider: "cloudflare", ci: "cloudflare-native" },
    enums: { OrderStatus: ["PENDING", "PAID"], UserRole: ["ADMIN", "CUSTOMER"] },
    entities: {
      User: {
        fields: {
          email: { type: "string", unique: true },
          role: { type: "enum", enumName: "UserRole", default: "CUSTOMER" },
        },
        relations: {},
        timestamps: true,
        softDelete: true,
      },
      Order: {
        fields: {
          status: { type: "enum", enumName: "OrderStatus", default: "PENDING" },
          total: { type: "number", default: 10.5 },
        },
        relations: {
          customer: {
            type: "many-to-one",
            target: "User",
            foreignKey: "customer_id",
            onDelete: "restrict",
          },
          items: { type: "one-to-many", target: "OrderItem", foreignKey: "order_id" },
        },
        timestamps: true,
        softDelete: true,
      },
      OrderItem: {
        fields: {
          quantity: { type: "number", default: 1 },
          note: { type: "string", required: false },
        },
        relations: {
          order: {
            type: "many-to-one",
            target: "Order",
            foreignKey: "order_id",
            onDelete: "cascade",
          },
        },
        timestamps: true,
        softDelete: false,
      },
    },
    endpoints: [
      {
        path: "/api/orders/summary",
        method: "GET",
        entity: "Order",
        authRequired: true,
        roles: ["admin"],
        queryParams: [{ name: "status", type: "enum", enumName: "OrderStatus", required: false }],
        joins: [
          { entity: "User", type: "inner", fields: ["id", "email"] },
          { entity: "OrderItem", type: "left", fields: ["quantity"] },
        ],
      },
    ],
  };
}

export const comprehensiveYaml = `
name: sample-commerce
version: 1.0.0
frontends:
  - name: store-web
    framework: nextjs
    path: apps/store-web
    connectsTo: core-api
    stateManagement: { client: zustand, server: tanstack-query, generateHooks: true }
backends:
  - name: core-api
    framework: hono
    path: apps/api-core
    auth: { type: jwt, roles: [admin, customer] }
database: { engine: postgres, provider: neon, orm: drizzle }
deployment: { provider: cloudflare, ci: cloudflare-native }
enums:
  UserRole: [ADMIN, CUSTOMER]
  OrderStatus: [PENDING, PAID]
entities:
  User:
    fields:
      email: { type: string, unique: true }
      role: { type: enum, enumName: UserRole, default: CUSTOMER }
    timestamps: true
    softDelete: true
  Order:
    fields:
      status: { type: enum, enumName: OrderStatus, default: PENDING }
    relations:
      customer: { type: many-to-one, target: User, foreignKey: customer_id, onDelete: restrict }
endpoints:
  - path: /api/orders/summary
    method: GET
    entity: Order
    authRequired: true
    roles: [admin]
    queryParams:
      - { name: status, type: enum, enumName: OrderStatus, required: false }
    joins:
      - { entity: User, type: inner, fields: [id, email] }
`;
