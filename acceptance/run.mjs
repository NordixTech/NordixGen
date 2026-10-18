import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { copyFile, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, command, freePort, images, names, ready, start } from "./resources.mjs";
import { verifyApplication } from "./verify.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const parent = join(root, "tmp", "acceptance");
const cleanupId = process.argv[2] === "--cleanup" ? process.argv[3] : undefined;
if (cleanupId) {
  assert.match(cleanupId, /^[a-f0-9]{16}$/);
  const state = JSON.parse(await readFile(join(parent, cleanupId, "state.json"), "utf8"));
  assert.equal(state.id, cleanupId);
  assert.equal(state.output, join(parent, cleanupId, "project"));
  await cleanup(state, root);
  console.log(`Acceptance ${cleanupId} resources stopped.`);
} else {
  assert.ok(
    process.argv.slice(2).every((arg) => arg === "--keep"),
    "Use pnpm acceptance [--keep] or --cleanup <run-id>.",
  );
  assert.ok(Number(process.versions.node.split(".")[0]) >= 24, "Node.js 24+ is required.");
  assert.ok(
    ["win32", "linux"].includes(process.platform),
    "The acceptance process cleanup currently supports Windows and Linux runners.",
  );
  const pnpm = process.env.npm_execpath;
  assert.ok(
    pnpm && /pnpm\.(c?js)$/.test(pnpm),
    "Run through pnpm 10.5.2: pnpm acceptance [--keep].",
  );
  const id = randomBytes(8).toString("hex");
  const directory = join(parent, id);
  await mkdir(directory, { recursive: true });
  assert.ok(directory.startsWith(`${parent}${sep}`));
  const state = {
    id,
    output: join(directory, "project"),
    databaseName: `nordixgen_acceptance_${id}`,
    secret: randomBytes(40).toString("hex"),
    apiPort: await freePort(),
    webPort: await freePort(),
    pids: [],
  };
  assert.notEqual(state.apiPort, state.webPort);
  const stateFile = join(directory, "state.json");
  const save = () => writeFile(stateFile, JSON.stringify(state, null, 2), { mode: 0o600 });
  await save();
  const report = {
    revision: (await command("git", ["rev-parse", "HEAD"], root)).trim(),
    startedAt: new Date().toISOString(),
    run: id,
    stages: [],
    result: "running",
    workingTree: (await command("git", ["status", "--porcelain"], root)).trim(),
  };
  let stage = "prerequisites";
  let success = false;
  const env = {
    ...process.env,
    NORDIXGEN_ACCEPTANCE_STATE: stateFile,
    NEXT_TELEMETRY_DISABLED: "1",
    WRANGLER_SEND_METRICS: "false",
  };
  // Windows environment names are case-insensitive; plain objects are not. Keep one PATH key.
  const inheritedPath = process.env.PATH ?? process.env.Path ?? "";
  for (const key of Object.keys(env)) if (key.toLowerCase() === "path") delete env[key];
  env.PATH = `${dirname(process.execPath)}${process.platform === "win32" ? ";" : ":"}${inheritedPath}`;
  // Never inherit real application destinations or credentials into the acceptance application.
  for (const key of Object.keys(env))
    if (/^(NEXT_PUBLIC_|BETTER_AUTH_|AUTH_TRUSTED_ORIGINS$|DATABASE_URL$)/.test(key))
      delete env[key];
  env.NEXT_PUBLIC_API_BASE_URL = `http://localhost:${state.apiPort}`;
  env.NEXT_PUBLIC_AUTH_BASE_URL = `http://localhost:${state.apiPort}`;
  const pnpmCommand = (args, cwd = root) => command(process.execPath, [pnpm, ...args], cwd, env);
  const runStage = async (name, action) => {
    stage = name;
    console.log(`Acceptance: ${name}`);
    const output = await action();
    if (typeof output === "string")
      await writeFile(
        join(directory, `${name}.log`),
        output.replaceAll(state.secret, "[redacted]"),
      );
    report.stages.push({ name, result: "passed" });
  };
  try {
    await runStage("prerequisites", async () => {
      assert.equal(
        (await pnpmCommand(["--version"])).trim(),
        "10.5.2",
        "Use the repository's pinned pnpm version.",
      );
      await command("docker", ["info", "--format", "{{.ServerVersion}}"], root);
      // Fail before generation if Chromium has not been installed. Never silently skip browsers.
      const { chromium } = await import("@playwright/test");
      const browser = await chromium.launch();
      await browser.close();
      const bin = join(directory, "bin");
      await mkdir(bin);
      if (process.platform === "win32")
        await writeFile(
          join(bin, "pnpm.cmd"),
          `@echo off\r\n"${process.execPath}" "${pnpm}" %*\r\n`,
        );
      else {
        const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
        await writeFile(
          join(bin, "pnpm"),
          `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(pnpm)} "$@"\n`,
          { mode: 0o755 },
        );
      }
      env.PATH = `${bin}${process.platform === "win32" ? ";" : ":"}${env.PATH}`;
    });
    await runStage("build-generator", () => pnpmCommand(["build"]));
    report.sourceHashes = Object.fromEntries(
      await Promise.all(
        [
          "packages/core/dist/index.js",
          "packages/cli/dist/index.js",
          "acceptance/project.yaml",
        ].map(async (file) => [
          file,
          createHash("sha256")
            .update(await readFile(join(root, file)))
            .digest("hex"),
        ]),
      ),
    );
    await runStage("validate-generate", async () => {
      const cli = join(root, "packages/cli/dist/index.js");
      const fixture = join(root, "acceptance/project.yaml");
      const validated = await command(
        process.execPath,
        [cli, "validate", "-f", fixture],
        root,
        env,
      );
      const generated = await command(
        process.execPath,
        [cli, "generate", "-f", fixture, "-o", state.output],
        root,
        env,
      );
      return validated + generated;
    });
    const api = join(state.output, "apps/api");
    const web = join(state.output, "apps/web");
    await runStage("authored-contract-and-boundaries", async () => {
      await copyFile(
        join(root, "acceptance/preview-customer.ts"),
        join(api, "src/modules/billing/application/preview-customer.ts"),
      );
      await copyFile(join(root, "acceptance/runtime.ts"), join(api, "acceptance-runtime.ts"));
      const check = () => pnpmCommand(["run", "check:boundaries"], api);
      await check();
      const probe = join(api, "src/modules/billing/application/forbidden-acceptance-probe.ts");
      try {
        await writeFile(
          probe,
          'import "../../customers/infrastructure/database/schema/Customer.table.js";\n',
        );
        await assert.rejects(
          check(),
          (error) =>
            /MODULE_PRIVATE_IMPORT/.test(error.message) &&
            /ARCHITECTURE_DEPENDENCY_INVALID/.test(error.message) &&
            error.message.includes("forbidden-acceptance-probe.ts"),
        );
      } finally {
        await unlink(probe);
      }
      await check();
      return pnpmCommand(["run", "typecheck"], api);
    });
    await runStage("build-generated-backend", () =>
      pnpmCommand(
        ["exec", "wrangler", "deploy", "--dry-run", "--outdir", ".acceptance-worker"],
        api,
      ),
    );
    const owned = names(state);
    const label = [
      "--label",
      "nordixgen-purpose=integrated-acceptance",
      "--label",
      `nordixgen-run=${id}`,
    ];
    await runStage("isolated-database", async () => {
      await command("docker", ["network", "create", ...label, owned.network], root);
      await command(
        "docker",
        [
          "run",
          "--detach",
          "--name",
          owned.database,
          ...label,
          "--network",
          owned.network,
          "--tmpfs",
          "/var/lib/postgresql/data",
          "-e",
          "POSTGRES_USER=nordixgen_test",
          "-e",
          "POSTGRES_PASSWORD=acceptance-only",
          "-e",
          `POSTGRES_DB=${state.databaseName}`,
          images.postgres,
        ],
        root,
      );
      let connected = false;
      for (let attempt = 0; attempt < 40; attempt++) {
        try {
          await command(
            "docker",
            [
              "exec",
              owned.database,
              "pg_isready",
              "-U",
              "nordixgen_test",
              "-d",
              state.databaseName,
            ],
            root,
          );
          connected = true;
          break;
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }
      assert.ok(connected, "The isolated PostgreSQL database did not become ready.");
      await command(
        "docker",
        [
          "run",
          "--detach",
          "--name",
          owned.proxy,
          ...label,
          "--network",
          owned.network,
          "-p",
          "127.0.0.1::4444",
          "-e",
          `PG_CONNECTION_STRING=postgres://nordixgen_test:acceptance-only@${owned.database}:5432/${state.databaseName}`,
          images.proxy,
        ],
        root,
      );
      state.proxyPort = Number(
        JSON.parse(await command("docker", ["inspect", owned.proxy], root))[0].NetworkSettings
          .Ports["4444/tcp"][0].HostPort,
      );
      await save();
      await ready(`http://127.0.0.1:${state.proxyPort}/`, { exitCode: null });
      return "Unique database/network/proxy created; no existing database is reset or reused.";
    });
    const runtime = join(api, "acceptance-runtime.ts");
    const tsx = join(api, "node_modules/tsx/dist/cli.mjs");
    await runStage("migrations-seeds-identity", async () => {
      await pnpmCommand(["run", "db:generate"], api);
      return command(process.execPath, [tsx, runtime, "prepare"], api, env);
    });
    await runStage("build-generated-frontend", async () => {
      await writeFile(
        join(web, ".env.local"),
        `NEXT_PUBLIC_API_BASE_URL=http://localhost:${state.apiPort}\nNEXT_PUBLIC_AUTH_BASE_URL=http://localhost:${state.apiPort}\n`,
      );
      await pnpmCommand(["run", "typecheck"], web);
      return pnpmCommand(["run", "build"], web);
    });
    await runStage("start-generated-applications", async () => {
      const backend = await start(
        process.execPath,
        [tsx, runtime, "serve"],
        api,
        env,
        join(directory, "backend.log"),
      );
      state.pids.push(backend.pid);
      await save();
      await ready(`http://localhost:${state.apiPort}/api/customers`, backend);
      const frontend = await start(
        process.execPath,
        [
          join(web, "node_modules/next/dist/bin/next"),
          "start",
          "--hostname",
          "127.0.0.1",
          "--port",
          String(state.webPort),
        ],
        web,
        env,
        join(directory, "frontend.log"),
      );
      state.pids.push(frontend.pid);
      await save();
      await ready(`http://localhost:${state.webPort}/`, frontend);
    });
    await runStage("http-browser-acceptance", async () => {
      report.behaviors = await verifyApplication(state, directory, () =>
        command(process.execPath, [tsx, runtime, "expire-accountant"], api, env),
      );
      return `${report.behaviors.length} integrated behaviors verified without mocked HTTP/database/session responses.`;
    });
    success = true;
    report.result = "passed";
    report.frontend = `http://localhost:${state.webPort}`;
    report.backend = `http://localhost:${state.apiPort}`;
  } catch (error) {
    report.result = "failed";
    report.failedStage = stage;
    report.error = String(error?.stack ?? error).replaceAll(state.secret, "[redacted]");
    console.error(`Acceptance failed at ${stage}. ${report.error}`);
    process.exitCode = 1;
  } finally {
    if (!(success && process.argv.includes("--keep"))) {
      try {
        await cleanup(state, root);
        report.resources = "cleaned";
      } catch (error) {
        report.cleanupError = String(error);
        report.result = "failed";
        process.exitCode = 1;
      }
    } else report.resources = "kept-for-local-review";
    report.finishedAt = new Date().toISOString();
    await writeFile(join(directory, "report.json"), JSON.stringify(report, null, 2));
    console.log(`Acceptance ${report.result}: ${join(directory, "report.json")}`);
    if (report.resources === "kept-for-local-review")
      console.log(`Review ${report.frontend} — stop with pnpm acceptance --cleanup ${id}`);
  }
}
