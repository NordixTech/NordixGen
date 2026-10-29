import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
if (!process.env.NORDIXGEN_TEST_DATABASE_URL)
  throw Error(
    "Set the explicitly isolated NORDIXGEN_TEST_DATABASE_URL. This benchmark resets that test database.",
  );
const pnpm = process.env.npm_execpath;
if (!pnpm) throw Error("Run through pnpm: pnpm benchmark:authorization");
const result = spawnSync(
  process.execPath,
  [
    pnpm,
    "--filter",
    "@nordix-tech/nordixgen-core",
    "exec",
    "vitest",
    "run",
    "tests/performance-benchmark.test.ts",
  ],
  { cwd: root, stdio: "inherit", env: { ...process.env, NORDIXGEN_BENCHMARK: "1" } },
);
process.exitCode = result.status ?? 1;
