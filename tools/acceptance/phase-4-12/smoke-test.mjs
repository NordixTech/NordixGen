import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const baseUrl = (process.env.NORDIXGEN_ACCEPTANCE_BASE_URL ?? "http://127.0.0.1:8787").replace(
  /\/$/,
  "",
);
const composeFile = resolve("tools/acceptance/phase-4-12/compose.yaml");
const origin = "http://localhost:8787";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function request(path, { method = "GET", body, cookie, originHeader = false } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (cookie) headers.Cookie = cookie;
  if (originHeader) headers.Origin = origin;
  return fetch(`${baseUrl}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function readJson(response) {
  return response.json();
}

function assertStatus(response, expected, label) {
  assert(
    response.status === expected,
    `${label}: expected HTTP ${expected}, received ${response.status}: ${response.statusText}`,
  );
}

async function signUp(label) {
  const email = `phase412-${label}-${crypto.randomUUID()}@example.test`;
  const response = await request("/api/auth/sign-up/email", {
    method: "POST",
    body: { name: "Phase 4.12 Acceptance", email, password: "Phase412-Test-Password-2026!" },
    originHeader: true,
  });
  assertStatus(response, 200, `Better Auth signup (${label})`);
  const cookie = response.headers
    .getSetCookie()
    .map((header) => header.split(";", 1)[0])
    .join("; ");
  assert(cookie.length > 0, `Better Auth signup (${label}) did not set a session cookie`);
  return { email, cookie };
}

async function main() {
  const health = await request("/health");
  assertStatus(health, 200, "health endpoint");
  console.log("PASS health endpoint");

  const unauthenticated = await request("/orders");
  assertStatus(unauthenticated, 401, "unauthenticated CRUD access");
  console.log("PASS authentication required");

  const customer = await signUp("customer");
  const usersResponse = await request("/users", { cookie: customer.cookie });
  assertStatus(usersResponse, 200, "authenticated user list");
  const users = await readJson(usersResponse);
  assert(users.length > 0, "user seed data is missing");
  console.log("PASS authenticated CRUD list");

  const summaryResponse = await request("/api/orders/summary?page=1&pageSize=25", {
    cookie: customer.cookie,
  });
  assertStatus(summaryResponse, 200, "joined paginated summary");
  const summary = await readJson(summaryResponse);
  assert(summary.items.length > 0, "joined summary returned no seeded orders");
  assert(typeof summary.total === "number", "summary total is not numeric");
  const numericItem = summary.items.find((item) => item.joins.OrderItem?.length > 0);
  assert(numericItem, "joined summary did not return any order items");
  assert(typeof numericItem.entity.total === "number", "decimal entity values are not numeric");
  assert(
    typeof numericItem.joins.OrderItem[0].unitPrice === "number",
    "decimal joined values are not numeric",
  );

  const joinedEmail = summary.items.find((item) => item.joins.User)?.joins.User.email;
  assert(joinedEmail, "joined summary did not return a customer");
  const byCustomerResponse = await request(
    `/api/orders/summary?customerEmail=${encodeURIComponent(joinedEmail)}&pageSize=25`,
    { cookie: customer.cookie },
  );
  assertStatus(byCustomerResponse, 200, "filter on joined User entity");
  const byCustomer = await readJson(byCustomerResponse);
  assert(byCustomer.items.length > 0, "joined User filter returned no matching orders");
  assert(
    byCustomer.items.every((item) => item.joins.User.email === joinedEmail),
    "joined User filter returned an unrelated customer",
  );

  const sampleItem = summary.items.find((item) => item.joins.OrderItem?.length > 0)?.joins.OrderItem[0];
  assert(sampleItem, "joined summary did not return any seeded OrderItem");
  const quantityResponse = await request(
    `/api/orders/summary?itemQuantity=${sampleItem.quantity}&pageSize=25`,
    { cookie: customer.cookie },
  );
  assertStatus(quantityResponse, 200, "filter on one-to-many OrderItem entity");
  const byQuantity = await readJson(quantityResponse);
  assert(byQuantity.items.length > 0, "OrderItem filter returned no matching orders");
  assert(
    byQuantity.items.every((item) => item.joins.OrderItem.some((orderItem) => orderItem.quantity === sampleItem.quantity)),
    "OrderItem filter returned an order without the requested quantity",
  );

  const pendingResponse = await request(
    "/api/orders/summary?status=pending&page=1&pageSize=25",
    { cookie: customer.cookie },
  );
  assertStatus(pendingResponse, 200, "filter and pagination on Order entity");
  const pending = await readJson(pendingResponse);
  assert(
    pending.items.every((item) => item.entity.status === "pending"),
    "root entity filter returned an order with a different status",
  );
  assert(pending.total >= pending.items.length, "filtered page total is smaller than returned items");
  console.log("PASS joins, root and many-to-one/one-to-many filters, pagination, decimal mapping");

  const createResponse = await request("/orders", {
    method: "POST",
    body: {
      orderNumber: `ACCEPT-${crypto.randomUUID().slice(0, 18)}`,
      total: 125.5,
      customer_id: users[0].id,
    },
    cookie: customer.cookie,
    originHeader: true,
  });
  assertStatus(createResponse, 201, "create Order");
  const created = await readJson(createResponse);
  assert(created.createdAt && created.updatedAt, "created timestamps were not populated");

  const readResponse = await request(`/orders/${created.id}`, { cookie: customer.cookie });
  assertStatus(readResponse, 200, "read Order");
  const updateResponse = await request(`/orders/${created.id}`, {
    method: "PATCH",
    body: { status: "paid" },
    cookie: customer.cookie,
    originHeader: true,
  });
  assertStatus(updateResponse, 200, "update Order");
  assert((await readJson(updateResponse)).status === "paid", "Order status was not updated");
  const deleteResponse = await request(`/orders/${created.id}`, {
    method: "DELETE",
    cookie: customer.cookie,
    originHeader: true,
  });
  assertStatus(deleteResponse, 204, "timestamp soft delete Order");
  assertStatus(
    await request(`/orders/${created.id}`, { cookie: customer.cookie }),
    404,
    "read timestamp-soft-deleted Order",
  );

  const categoryResponse = await request("/categorys", {
    method: "POST",
    body: { name: `Acceptance ${crypto.randomUUID().slice(0, 12)}` },
    cookie: customer.cookie,
    originHeader: true,
  });
  assertStatus(categoryResponse, 201, "create Category");
  const category = await readJson(categoryResponse);
  assertStatus(
    await request(`/categorys/${category.id}`, {
      method: "DELETE",
      cookie: customer.cookie,
      originHeader: true,
    }),
    204,
    "boolean soft delete Category",
  );
  assertStatus(
    await request(`/categorys/${category.id}`, { cookie: customer.cookie }),
    404,
    "read boolean-soft-deleted Category",
  );
  console.log("PASS CRUD, generated timestamps, boolean and timestamp soft deletes");

  const denied = await signUp("denied");
  execFileSync(
    "docker",
    [
      "compose",
      "-f",
      composeFile,
      "exec",
      "-T",
      "postgres",
      "psql",
      "-U",
      "postgres",
      "-d",
      "nordix_test",
      "-c",
      `UPDATE auth_user SET role = 'guest' WHERE email = '${denied.email}'`,
    ],
    { stdio: "ignore" },
  );
  assertStatus(
    await request("/api/orders/summary", { cookie: denied.cookie }),
    403,
    "RBAC denial for an unapproved role",
  );
  console.log("PASS RBAC role and permission enforcement");
  console.log("Phase 4.12 HTTP smoke test passed.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
