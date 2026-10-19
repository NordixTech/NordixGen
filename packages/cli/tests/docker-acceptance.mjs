import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { command } from "../../../examples/full-stack-commerce/scripts/resources.mjs";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const id = randomBytes(6).toString("hex");
const layout = process.argv[2] ?? "monorepo";
assert.ok(["monorepo", "split"].includes(layout));
const directory = join(root, "tmp", "docker-acceptance", `${layout}-${id}`);
await mkdir(directory, { recursive: true });
const output = join(directory, "output");
const split = layout === "split";
const config = {
  schemaVersion: 2,
  name: `docker-${id}`,
  version: "1.0.0",
  repositories: split
    ? [
        { name: "backend", path: "backend" },
        { name: "frontend", path: "frontend" },
      ]
    : [{ name: "app", path: "." }],
  databases: { primary: {} },
  backends: [
    {
      name: "api",
      repository: split ? "backend" : "app",
      path: split ? "." : "apps/api",
      persistence: { database: "primary" },
      modules: { examples: { architecture: "clean", entities: ["Example"] } },
      authentication: { methods: ["email-password"] },
    },
  ],
  frontends: [
    {
      name: "web",
      repository: split ? "frontend" : "app",
      path: split ? "." : "apps/web",
      connectsTo: ["api"],
      access: { mode: "authenticated", backend: "api" },
    },
  ],
  entities: {
    Example: {
      backend: "api",
      fields: { name: { type: "string", required: true, minLength: 1, maxLength: 120 } },
    },
  },
  pagination: { standard: {} },
  endpoints: [
    {
      backend: "api",
      entity: "Example",
      operationId: "listExamples",
      method: "GET",
      path: "/api/examples",
      pagination: "standard",
      authRequired: false,
    },
    {
      backend: "api",
      entity: "Example",
      operationId: "createExample",
      method: "POST",
      path: "/api/examples",
      requestBody: { useCase: { entity: "Example", operation: "create" } },
      authRequired: false,
    },
  ],
};
async function freePort() {
  const server = createServer();
  await new Promise((done, reject) => {
    server.once("error", reject);
    server.listen(0, "0.0.0.0", done);
  });
  const port = server.address().port;
  await new Promise((done) => server.close(done));
  return port;
}
const apiPort = await freePort();
const webPort = await freePort();
const dbPort = await freePort();
const env = {
  ...process.env,
  BACKEND_API_PORT: String(apiPort),
  FRONTEND_WEB_PORT: String(webPort),
  POSTGRES_API_PORT: String(dbPort),
};
const repositories = config.repositories.map((repo) => ({
  directory: resolve(output, repo.path),
  name: `nordixgen-docker-${id}-${repo.name}`,
}));
async function compose(repo, args, label) {
  try {
    const result = await command(
      "docker",
      ["compose", "-p", repo.name, ...args],
      repo.directory,
      env,
    );
    await writeFile(join(directory, `${label}.log`), result);
    return result;
  } catch (error) {
    await writeFile(join(directory, `${label}.log`), error.message);
    throw error;
  }
}
let generated = false;
let browser;
try {
  const file = join(directory, "project.yaml");
  await writeFile(file, JSON.stringify(config, null, 2));
  console.log(`Generating fresh ${layout} fixture: ${directory}`);
  await command(
    process.execPath,
    [join(root, "packages/cli/dist/index.js"), "generate", "-f", file, "-o", output],
    root,
  );
  generated = true;
  for (const repo of repositories) {
    await compose(repo, ["config", "--quiet"], `${repo.name}-config`);
    console.log(`Building and booting ${repo.name}`);
    await compose(
      repo,
      ["up", "-d", "--build", "--wait", "--wait-timeout", "240"],
      `${repo.name}-up`,
    );
  }
  const api = `http://localhost:${apiPort}`;
  const web = `http://localhost:${webPort}`;
  const initial = await fetch(`${api}/api/examples`).then((response) => response.json());
  assert.equal(initial.total, 5, "Expected one initial synthetic seed");
  const created = await fetch(`${api}/api/examples`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: web },
    body: JSON.stringify({ name: "Docker persistence evidence" }),
  });
  assert.equal(created.status, 200);
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(web);
  assert.match(page.url(), /\/sign-in/);
  const signup = await context.request.post(`${api}/api/auth/sign-up/email`, {
    headers: { origin: web },
    data: {
      name: "Local Docker User",
      email: `${id}@docker.example.test`,
      password: "Docker-acceptance-2026!",
    },
  });
  assert.equal(signup.status(), 200, await signup.text());
  const response = await page.goto(`${web}/example`);
  assert.equal(response.status(), 200, "Server page guard must reach internal identity authority");
  assert.ok(!page.url().includes("sign-in"));
  await page.getByText("Docker persistence evidence", { exact: true }).waitFor({ timeout: 30000 });
  assert.deepEqual(errors, []);
  await page.screenshot({ path: join(directory, "application.png"), fullPage: true });
  const uid = await compose(
    repositories[0],
    ["exec", "-T", "backend-api", "id", "-u"],
    "backend-user",
  );
  assert.notEqual(uid.trim(), "0");
  for (const repo of repositories) await compose(repo, ["restart"], `${repo.name}-restart`);
  for (const repo of repositories)
    await compose(repo, ["up", "-d", "--wait", "--wait-timeout", "240"], `${repo.name}-ready`);
  const after = await fetch(`${api}/api/examples`).then((response) => response.json());
  assert.equal(after.total, 6, "Restart must retain business data and skip the synthetic seed");
  // Rebuilding must reuse the checked-in SQL journal, rather than invent a new initial migration.
  await compose(repositories[0], ["build", "--no-cache", "backend-api"], "backend-rebuild");
  await compose(
    repositories[0],
    ["up", "-d", "--wait", "--wait-timeout", "240"],
    "backend-rebuilt-ready",
  );
  const rebuilt = await fetch(`${api}/api/examples`).then((response) => response.json());
  assert.equal(
    rebuilt.total,
    6,
    "A freshly rebuilt image must migrate the existing volume without replaying initial SQL or seeds",
  );
  console.log(
    `PASS ${layout}: migrations, one-time seeds, browser API/auth, private SSR identity, non-root runtime and persistence after restart.`,
  );
  await writeFile(
    join(directory, "report.json"),
    JSON.stringify(
      { layout, status: "passed", initial: initial.total, afterRestart: after.total },
      null,
      2,
    ),
  );
} finally {
  await browser?.close();
  if (generated)
    for (const repo of [...repositories].reverse()) {
      await compose(repo, ["logs", "--no-color"], `${repo.name}-services`).catch(console.error);
      await compose(
        repo,
        ["down", "-v", "--remove-orphans", "--rmi", "local"],
        `${repo.name}-cleanup`,
      ).catch(console.error);
    }
}
