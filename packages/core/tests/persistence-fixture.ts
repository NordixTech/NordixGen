import { targetConfig } from "./fixtures.js";
export function persistenceFixture(auth = true) {
  const config = targetConfig();
  config.entities.Invoice.fields.total.default = 12.5;
  config.enums.EntityState = ["active", "archived"];
  config.entities.Customer.fields.state = {
    type: "enum",
    enumName: "EntityState",
    required: true,
    unique: false,
    default: "active",
  };
  Object.assign(config.entities.Invoice, {
    softDelete: "boolean",
    timestamps: { createdAt: true, updatedAt: true },
  });
  Object.assign(config.entities.Invoice.fields, {
    state: { type: "enum", enumName: "EntityState", default: "active" },
    discount: {
      type: "number",
      format: "decimal",
      precision: 5,
      scale: 2,
      required: false,
      default: null,
    },
    payload: { type: "json", required: true, default: { currency: "USD" } },
  });
  config.entities.Invoice.relations.lines = {
    type: "one-to-many",
    target: "InvoiceLine",
    foreignKey: "invoiceId",
    required: false,
  };
  config.entities.InvoiceLine = {
    backend: "api",
    fields: {
      quantity: { type: "number", format: "integer", required: true, unique: false },
      unitPrice: {
        type: "number",
        format: "decimal",
        precision: 5,
        scale: 2,
        required: true,
        unique: false,
      },
    },
    relations: {
      invoice: {
        type: "many-to-one",
        target: "Invoice",
        foreignKey: "invoiceId",
        required: true,
        onDelete: "cascade",
      },
    },
    timestamps: { createdAt: false, updatedAt: false },
    softDelete: "timestamp",
  };
  config.backends[0].modules.billing.entities.push("InvoiceLine");
  const list = config.endpoints.find((operation) => operation.operationId === "listInvoices");
  if (!list) throw Error("Missing invoice query");
  list.queryParams = [
    {
      name: "search",
      field: { entity: "Invoice", field: "note" },
      operator: "contains",
      required: false,
    },
    {
      name: "minimum",
      field: { entity: "Invoice", field: "total" },
      operator: "gte",
      required: false,
    },
  ];
  list.pagination = "standard";
  list.joins = [{ entity: "InvoiceLine", type: "left", fields: ["quantity", "unitPrice"] }];
  config.endpoints.push(
    {
      backend: "api",
      entity: "Invoice",
      operationId: "createInvoice",
      method: "POST",
      path: "/api/invoices",
      permissions: ["invoices:write"],
      requestBody: { useCase: { entity: "Invoice", operation: "create" } },
    },
    {
      backend: "api",
      entity: "Invoice",
      operationId: "updateInvoice",
      method: "PATCH",
      path: "/api/invoices/{invoiceKey}",
      permissions: ["invoices:write"],
      pathParams: [{ name: "invoiceKey", field: { entity: "Invoice", field: "id" } }],
      requestBody: { useCase: { entity: "Invoice", operation: "update" } },
    },
    {
      backend: "api",
      entity: "Invoice",
      operationId: "deleteInvoice",
      method: "DELETE",
      path: "/api/invoices/{invoiceKey}",
      permissions: ["invoices:write"],
      pathParams: [{ name: "invoiceKey", field: { entity: "Invoice", field: "id" } }],
    },
    {
      backend: "api",
      entity: "InvoiceLine",
      operationId: "createLine",
      method: "POST",
      path: "/api/lines",
      requestBody: { useCase: { entity: "InvoiceLine", operation: "create" } },
    },
    {
      backend: "api",
      entity: "InvoiceLine",
      operationId: "deleteLine",
      method: "DELETE",
      path: "/api/lines/{lineKey}",
      pathParams: [{ name: "lineKey", field: { entity: "InvoiceLine", field: "id" } }],
    },
    {
      backend: "api",
      entity: "Invoice",
      operationId: "withLines",
      method: "GET",
      path: "/api/invoices/with-lines",
      queryParams: [
        {
          name: "search",
          field: { entity: "Invoice", field: "note" },
          operator: "contains",
          required: false,
        },
      ],
      joins: [{ entity: "InvoiceLine", type: "inner", fields: ["quantity"] }],
      pagination: "standard",
    },
    {
      backend: "api",
      entity: "InvoiceLine",
      operationId: "listLines",
      method: "GET",
      path: "/api/lines",
      queryParams: [
        {
          name: "search",
          field: { entity: "Invoice", field: "note" },
          operator: "contains",
          required: false,
        },
        {
          name: "below",
          field: { entity: "Invoice", field: "total" },
          operator: "lt",
          required: false,
        },
        {
          name: "quantities",
          field: { entity: "InvoiceLine", field: "quantity" },
          operator: "in",
          required: false,
        },
      ],
      joins: [{ entity: "Invoice", type: "inner", fields: ["id", "total"] }],
      pagination: "standard",
    },
  );
  if (!auth) {
    config.backends[0].authentication = undefined;
    config.backends[0].authorization = undefined;
    config.frontends[0].access = { mode: "public" };
    for (const operation of config.endpoints) {
      operation.authRequired = false;
      operation.roles = [];
      operation.permissions = [];
    }
  }
  return config;
}

export function constrainedPersistenceFixture() {
  const config = persistenceFixture(false);

  config.entities.SeedConstraint = {
    backend: "api",
    fields: {
      choice: { type: "enum", enumName: "EntityState", required: true, unique: true },
      flag: { type: "boolean", required: true, unique: true },
      count: { type: "number", format: "integer", required: true, unique: true },
      amount: {
        type: "number",
        format: "decimal",
        precision: 3,
        scale: 2,
        required: true,
        unique: true,
      },
      payload: { type: "json", required: true, unique: true },
      code: { type: "string", required: true, unique: true, minLength: 8, maxLength: 10 },
      nullableLabel: { type: "string", required: false, default: null, maxLength: 10 },
      startsAt: { type: "date", required: true, default: "2025-01-01T00:00:00.000Z" },
      observedAt: { type: "date", required: true, default: { kind: "now" } },
    },
    relations: {},
    timestamps: { createdAt: false, updatedAt: false },
    softDelete: false,
  };
  config.entities.SeedDetail = {
    backend: "api",
    fields: { label: { type: "string", required: true } },
    relations: {
      parent: {
        type: "one-to-one",
        target: "SeedConstraint",
        foreignKey: "parentId",
        required: true,
      },
    },
    timestamps: { createdAt: false, updatedAt: false },
    softDelete: false,
  };
  config.backends[0].modules.billing.entities.push("SeedConstraint", "SeedDetail");

  return config;
}
