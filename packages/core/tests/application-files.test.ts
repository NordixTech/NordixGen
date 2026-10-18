import { describe, expect, it } from "vitest";
import { generateBackend } from "../src/generation/backend.js";
import { createSecuredConfig, resolvedFixture } from "./fixtures.js";
import { generatedTypeErrors } from "./generated-types.js";

function composeFixture() {
  const config = createSecuredConfig();
  Object.assign(config.entities.Order.fields, {
    issuedAt: { type: "date", default: { kind: "now" } },
    fixedAt: { type: "date", default: "2024-01-01T01:00:00+01:00", required: false },
    payload: { type: "json", required: false },
    enabled: { type: "boolean", default: true },
    reference: { type: "uuid", required: false },
    note: { type: "string", required: false, default: null },
  });
  config.endpoints.push(
    {
      backend: "core-api",
      entity: "Order",
      operationId: "createOrder",
      method: "POST",
      path: "/api/orders",
      requestBody: { useCase: { entity: "Order", operation: "create" } },
    },
    {
      backend: "core-api",
      entity: "Order",
      operationId: "updateOrder",
      method: "PATCH",
      path: "/api/orders/{id}",
      pathParams: [{ name: "id", field: { entity: "Order", field: "id" } }],
      requestBody: { useCase: { entity: "Order", operation: "update" } },
    },
    {
      backend: "core-api",
      entity: "Order",
      operationId: "customOrder",
      method: "POST",
      path: "/api/orders/custom",
      queryParams: [
        { name: "trace", type: "boolean", required: false },
        { name: "json", type: "json", required: false },
        {
          name: "numbers",
          field: { entity: "Order", field: "total" },
          operator: "in",
          required: false,
        },
      ],
      requestBody: {
        title: { type: "string", minLength: 1, maxLength: 20 },
        when: { type: "date", default: { kind: "now" } },
        amount: { field: { entity: "Order", field: "total" }, required: false },
      },
    },
  );
  const project = resolvedFixture(config);
  const result = generateBackend(project, "core-api");
  if (!result.success) throw new Error(JSON.stringify(result.diagnostics));
  return { project, ...result };
}

describe("resolved application contracts and concrete DTO rendering", () => {
  it("emits effective fields and application dates without reconstructing implicit fields", () => {
    const result = composeFixture();
    const files = result.virtualFileSystem.snapshot();
    const root = "apps/api-core/src/modules/commerce";
    expect(files[`${root}/domain/entities/Order.entity.ts`]).toContain(
      '"customer_id": string | null;',
    );
    expect(files[`${root}/application/use-cases/dtos/Order.dto.ts`]).toContain(
      '"fixedAt": z.date().nullable().default(null)',
    );
    expect(files[`${root}/application/use-cases/dtos/endpoints/CreateOrder.dto.ts`]).toContain(
      'new Date("2024-01-01T00:00:00.000Z")',
    );
    expect(files[`${root}/application/use-cases/dtos/Order.dto.ts`]).toContain(
      '"note": z.string().nullable().default(null)',
    );
    expect(files[`${root}/application/use-cases/CreateOrder.use-case.ts`]).toContain(
      "this.clock.now()",
    );
  });
  it("uses flat application input and separate HTTP schemas with the same values", () => {
    const files = composeFixture().virtualFileSystem.snapshot();
    const dto = files[
      "apps/api-core/src/modules/commerce/application/use-cases/dtos/endpoints/UpdateOrder.dto.ts"
    ] as string;
    const input = dto.split("export const InputSchema")[1]?.split("export type Input")[0];
    expect(input).toContain('"id": z.string().uuid()');
    expect(input).not.toMatch(/path:|query:|body:/);
    expect(dto).toContain("export const PathParamsSchema");
    expect(dto).toContain("export const RequestBodySchema");
    expect(dto).toContain("At least one field must be updated.");
    expect(
      files[
        "apps/api-core/src/modules/commerce/presentation/controllers/updateOrder.controller.ts"
      ],
    ).toContain("const rawInput = { ...path, ...query, ...body }");
  });
  it("uses resolved clock defaults without giving callers server-generated fields", () => {
    const files = composeFixture().virtualFileSystem.snapshot();
    const create = files[
      "apps/api-core/src/modules/commerce/application/use-cases/CreateOrder.use-case.ts"
    ] as string;
    expect(create).toContain("createdAt: this.clock.now()");
    expect(create).toContain("updatedAt: this.clock.now()");
    expect(create).toContain(
      "issuedAt: input.issuedAt === undefined ? this.clock.now() : input.issuedAt",
    );
    const dto = files[
      "apps/api-core/src/modules/commerce/application/use-cases/dtos/endpoints/CreateOrder.dto.ts"
    ] as string;
    const input = dto.split("export const InputSchema")[1]?.split("export type Input")[0];
    expect(input).not.toMatch(/createdAt|updatedAt|deletedAt|isDeleted/);
    expect(
      files["apps/api-core/src/modules/commerce/application/use-cases/UpdateOrder.use-case.ts"],
    ).not.toContain("issuedAt: input.issuedAt");
  });
  it("renders query arrays, typed JSON and body aliases from pre-resolved inputs", () => {
    const files = composeFixture().virtualFileSystem.snapshot();
    const dto = files[
      "apps/api-core/src/modules/commerce/application/use-cases/dtos/endpoints/CustomOrder.dto.ts"
    ] as string;
    expect(dto).toContain('"numbers": z.array(');
    expect(dto).toContain('z.enum(["true", "false"])');
    expect(dto).toContain("Expected valid JSON text");
    expect(dto).toContain('"title": z.string().min(1).max(20)');
    expect(dto).toContain('"amount": z.number().finite().default(10.5)');
  });
  it("keeps collection joins nonnullable and preserves explicit projections", () => {
    const files = composeFixture().virtualFileSystem.snapshot();
    const dto = files[
      "apps/api-core/src/modules/commerce/application/use-cases/dtos/endpoints/GetOrderSummary.dto.ts"
    ] as string;
    expect(dto).toContain('"OrderItem": z.array(');
    expect(dto).not.toContain("}).nullable(),");
    expect(dto).toContain('OrderItemResponseSchema.shape["quantity"]');
    expect(dto).not.toContain('OrderItemResponseSchema.shape["note"]');
  });
  it("typechecks generated application DTOs and use cases against domain contracts", async () => {
    const result = composeFixture();
    const files = Object.fromEntries(
      Object.entries(result.virtualFileSystem.snapshot())
        .filter(
          ([path]) =>
            path.endsWith(".ts") &&
            (path.includes("/application/") ||
              path.includes("/domain/entities/") ||
              path.endsWith("/platform/authorization/policy.ts")),
        )
        .map(([path, source]) => [path.split("/src/")[1], source]),
    );
    expect(await generatedTypeErrors(files)).toEqual([]);
  }, 15_000);
});
