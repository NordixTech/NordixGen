import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { npm, packages, run } from "./lib.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const directory = await mkdtemp(join(tmpdir(), "nordixgen-package-"));
const version = JSON.parse(await readFile(join(root, "packages/cli/package.json"), "utf8")).version;
const registryVersion = process.argv[2];
await writeFile(join(directory, "package.json"), '{"private":true,"type":"module"}\n');
const specs = packages.map((pkg) =>
  registryVersion
    ? `${pkg.name}@${registryVersion}`
    : join(root, "tmp/release", `${pkg.name.slice(1).replace("/", "-")}-${version}.tgz`),
);
console.log(`Installing ${registryVersion ?? version} into isolated ${directory}`);
console.log(
  npm(["install", "--ignore-scripts", "--no-audit", "--no-fund", ...specs], { cwd: directory }),
);
const cli = join(directory, "node_modules/@nordix-tech/nordixgen/dist/index.js");
const core = join(directory, "node_modules/@nordix-tech/nordixgen-core");
assert.ok(
  (await realpath(core)).startsWith(`${directory}${sep}`),
  "Core must not link to the checkout",
);
for (const pkg of packages) {
  const packageRoot = join(directory, "node_modules", pkg.name);
  const manifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
  assert.equal(manifest.version, registryVersion ?? version);
  assert.ok(!JSON.stringify(manifest.dependencies).includes("workspace:"));
  await readFile(join(packageRoot, "LICENSE"), "utf8");
}
const invoke = (args) => run(process.execPath, [cli, ...args], { cwd: directory });
assert.match(invoke(["--help"]), /generate/);
assert.equal(invoke(["--version"]), registryVersion ?? version);
assert.equal(
  npm(["exec", "--offline", "--", "nordixgen", "--version"], { cwd: directory }),
  registryVersion ?? version,
);
assert.match(
  invoke(["info"]),
  new RegExp(`v${(registryVersion ?? version).replaceAll(".", "\\.")}`),
);
invoke(["init", "--name", "package-smoke", "--frontend", "no", "--file", "nordix.config.yaml"]);
assert.match(await readFile(join(directory, "nordix.config.yaml"), "utf8"), /package-smoke/);
invoke(["validate", "-f", "nordix.config.yaml"]);

// Exercise both public module formats, not workspace sources or test mocks.
await writeFile(
  join(directory, "check-api.mjs"),
  `
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import * as core from '@nordix-tech/nordixgen-core';
const cjs = createRequire(import.meta.url)('@nordix-tech/nordixgen-core');
assert.equal(core.CORE_VERSION, ${JSON.stringify(registryVersion ?? version)});
assert.equal(cjs.CORE_VERSION, core.CORE_VERSION);
`,
);
run(process.execPath, [join(directory, "check-api.mjs")], { cwd: directory });
// A real generation verifies bundled deployment/infrastructure helpers and external scaffolds.
const generated = join(directory, "project");
console.log(invoke(["generate", "-f", "nordix.config.yaml", "-o", generated]));
await readFile(join(generated, "apps/api/src/index.ts"), "utf8");
await readFile(join(generated, "scripts/cicd.mjs"), "utf8");
assert.equal(run("git", ["branch", "--show-current"], { cwd: generated }), "main");
console.log(`Package installation, init, validation and generation passed (${directory})`);
await mkdir(resolve(root, "tmp/release"), { recursive: true });
await copyFile(
  join(directory, "nordix.config.yaml"),
  resolve(root, "tmp/release/smoke.config.yaml"),
);
