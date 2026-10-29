import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

export const packages = [
  { directory: "core", name: "@nordix-tech/nordixgen-core" },
  { directory: "cli", name: "@nordix-tech/nordixgen" },
];

export function releaseVersion(base, runNumber) {
  if (!/^\d+\.\d+\.\d+$/.test(base) || !/^[1-9]\d*$/.test(String(runNumber)))
    throw new Error("Expected a stable base version and positive workflow run number");
  const [major, minor, patch] = base.split(".").map(Number);
  const next = patch + Number(runNumber);
  if (!Number.isSafeInteger(next)) throw new Error("Release patch exceeds the safe integer range");
  return `${major}.${minor}.${next}`;
}

export function compareVersions(a, b) {
  for (let i = 0; i < 3; i++) {
    const difference = Number(a.split(".")[i]) - Number(b.split(".")[i]);
    if (difference) return Math.sign(difference);
  }
  return 0;
}

export function verifyPublished(manifest, plan, integrity) {
  if (
    manifest.version !== plan.version ||
    manifest.nordixgenRelease?.commit !== plan.commit ||
    manifest.nordixgenRelease?.runId !== plan.runId ||
    manifest.dist?.integrity !== integrity
  )
    throw new Error(`Published ${manifest.name}@${manifest.version} does not match this release`);
}

export function run(file, args, options = {}) {
  return execFileSync(file, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    ...options,
  }).trim();
}

export function npm(args, options) {
  const cli = [
    join(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js"),
    join(dirname(process.execPath), "../lib/node_modules/npm/bin/npm-cli.js"),
  ].find(existsSync);
  if (!cli) throw new Error("npm CLI not found beside Node.js");
  return run(process.execPath, [cli, ...args], options);
}

export function pnpm(args, options) {
  const cli = process.env.npm_execpath;
  if (!cli || !/pnpm\.(c?js)$/.test(cli)) throw new Error("Run this script through pnpm");
  return run(process.execPath, [cli, ...args], options);
}

export async function registryPackage(name, version) {
  const response = await fetch(
    `https://registry.npmjs.org/${encodeURIComponent(name)}/${encodeURIComponent(version)}`,
    { headers: { "cache-control": "no-cache" } },
  );
  if (response.status === 404) return null;
  if (!response.ok)
    throw new Error(`npm registry returned ${response.status} for ${name}@${version}`);
  return response.json();
}
