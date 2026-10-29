import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  compareVersions,
  isPublicationConflict,
  npm,
  packages,
  pnpm,
  registryPackage,
  releaseVersion,
  run,
  verifyPublished,
  waitForPackage,
} from "./lib.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
process.chdir(root);
const output = resolve("tmp/release");
const json = async (path) => JSON.parse(await readFile(path, "utf8"));
const save = (path, value) => writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
const action = process.argv[2];

if (action === "prepare") {
  assert.equal(process.env.GITHUB_REF, "refs/heads/main", "Only main can produce a release");
  const commit = process.env.GITHUB_SHA;
  const runId = process.env.GITHUB_RUN_ID;
  assert.match(commit ?? "", /^[a-f0-9]{40}$/);
  assert.match(runId ?? "", /^[1-9]\d*$/);
  assert.equal(run("git", ["rev-parse", "HEAD"]), commit);
  const core = await json("packages/core/package.json");
  const cli = await json("packages/cli/package.json");
  assert.equal(core.version, cli.version, "Core and CLI must use the same release series");
  const version = releaseVersion(core.version, process.env.GITHUB_RUN_NUMBER);
  const plan = { version, commit, runId };
  await mkdir(output, { recursive: true });
  await save(resolve(output, "plan.json"), plan);
  for (const pkg of packages) {
    const path = `packages/${pkg.directory}/package.json`;
    const manifest = await json(path);
    manifest.version = version;
    manifest.nordixgenRelease = { commit, runId };
    await save(path, manifest);
    await copyFile("LICENSE", `packages/${pkg.directory}/LICENSE`);
  }
  console.log(`Prepared ${version} from ${commit} (workflow run ${runId})`);
} else if (action === "pack") {
  await mkdir(output, { recursive: true });
  for (const pkg of packages) {
    await copyFile("LICENSE", `packages/${pkg.directory}/LICENSE`);
    console.log(pnpm(["--dir", `packages/${pkg.directory}`, "pack", "--pack-destination", output]));
  }
} else if (action === "publish") {
  const plan = await json(resolve(output, "plan.json"));
  assert.equal(plan.commit, process.env.GITHUB_SHA);
  assert.equal(plan.runId, process.env.GITHUB_RUN_ID);
  assert.equal(process.env.GITHUB_REF, "refs/heads/main");
  const archives = [];
  for (const pkg of packages) {
    const tarball = resolve(output, `${pkg.name.slice(1).replace("/", "-")}-${plan.version}.tgz`);
    const integrity = `sha512-${createHash("sha512")
      .update(await readFile(tarball))
      .digest("base64")}`;
    archives.push({ ...pkg, integrity });
    const published = await registryPackage(pkg.name, plan.version);
    if (published) verifyPublished(published, plan, integrity);
    else {
      try {
        console.log(
          npm(["publish", tarball, "--access", "public", "--tag", "candidate"], {
            stdio: ["ignore", "pipe", "pipe"],
          }),
        );
      } catch (error) {
        // A prior attempt can have submitted the same version while npm is still processing it.
        // Only a publication conflict is recoverable; identity and integrity are verified below.
        if (!isPublicationConflict(error)) throw error;
        console.log(
          `${pkg.name}@${plan.version} was already submitted; verifying the existing tarball`,
        );
      }
    }
  }
  // Submit both packages first so registry processing can happen concurrently.
  for (const pkg of archives) {
    const published = await waitForPackage(pkg.name, plan.version);
    verifyPublished(published, plan, pkg.integrity);
    console.log(`Verified ${pkg.name}@${plan.version}`);
  }
  // Publish both packages before changing the user-facing latest channel.
  const latest = await Promise.all(packages.map((pkg) => registryPackage(pkg.name, "latest")));
  const superseded = latest.some(
    (manifest) => manifest && compareVersions(manifest.version, plan.version) > 0,
  );
  if (!superseded) {
    for (const pkg of packages)
      console.log(npm(["dist-tag", "add", `${pkg.name}@${plan.version}`, "latest"]));
  } else console.log("A newer release exists; keeping latest unchanged");

  const tag = `v${plan.version}`;
  const tags = run("git", ["tag", "--list", tag]);
  if (tags) assert.equal(run("git", ["rev-list", "-n", "1", tag]), plan.commit);
  else {
    run("git", ["tag", tag, plan.commit]);
    run("git", ["push", "origin", `refs/tags/${tag}`]);
  }
  try {
    run("gh", ["release", "view", tag, "--json", "tagName"], { stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    if (!/release not found|HTTP 404/i.test(String(error.stderr))) throw error;
    console.log(
      run("gh", [
        "release",
        "create",
        tag,
        "--verify-tag",
        "--title",
        `NordixGen ${plan.version}`,
        "--generate-notes",
        "--notes",
        `Source commit: ${plan.commit}. Install: npm install -g @nordix-tech/nordixgen@${plan.version}`,
      ]),
    );
  }
} else throw new Error("Use prepare, pack, or publish");
