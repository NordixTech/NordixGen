import assert from "node:assert/strict";
import { test } from "node:test";
import {
  compareVersions,
  isPublicationConflict,
  registryPackage,
  releaseVersion,
  verifyPublished,
  waitForPackage,
} from "./lib.mjs";

test("workflow runs produce increasing fixed versions and retries reuse the same version", () => {
  assert.equal(releaseVersion("0.1.0", "15"), "0.1.15");
  assert.equal(releaseVersion("0.1.0", "15"), releaseVersion("0.1.0", "15"));
  assert.equal(releaseVersion("0.1.0", "16"), "0.1.16");
  assert.equal(releaseVersion("1.0.0", "17"), "1.0.17");
});

test("invalid release inputs cannot allocate a version", () => {
  for (const value of [undefined, "", "0", "-1", "2.5", "abc"])
    assert.throws(() => releaseVersion("0.1.0", value));
  assert.throws(() => releaseVersion("0.1.0-beta.1", "1"));
});

test("publication verification allows several minutes of npm processing without republishing", async () => {
  let elapsed = 0;
  let reads = 0;
  const manifest = { version: "0.1.15" };
  const result = await waitForPackage("example", "0.1.15", {
    intervalMs: 60_000,
    now: () => elapsed,
    sleep: async (milliseconds) => {
      elapsed += milliseconds;
    },
    read: async () => {
      reads++;
      return elapsed >= 180_000 ? manifest : null;
    },
  });
  assert.equal(result, manifest);
  assert.equal(reads, 4);
  assert.equal(elapsed, 180_000);
});

test("processing timeouts are bounded and do not silently accept a missing package", async () => {
  let elapsed = 0;
  await assert.rejects(
    waitForPackage("example", "0.1.15", {
      timeoutMs: 20,
      intervalMs: 10,
      now: () => elapsed,
      sleep: async (milliseconds) => {
        elapsed += milliseconds;
      },
      read: async () => null,
    }),
    /still processing/,
  );
  assert.equal(elapsed, 20);
});

test("only an already submitted publication conflict is recoverable", () => {
  for (const text of [
    "EPUBLISHCONFLICT",
    "E409",
    "Cannot publish over previously published versions",
  ])
    assert.equal(isPublicationConflict({ stderr: text }), true);
  for (const text of ["E403 forbidden", "E404 permission denied", "EOTP", "network timeout"])
    assert.equal(isPublicationConflict({ stderr: text }), false);
});

test("registry checks refresh metadata and distinguish a missing version from registry failures", async (context) => {
  let status = 404;
  context.mock.method(globalThis, "fetch", async (_url, options) => {
    assert.equal(options.headers["cache-control"], "no-cache");
    return new Response(JSON.stringify({ version: "0.1.15" }), { status });
  });
  assert.equal(await registryPackage("@nordix-tech/nordixgen", "0.1.15"), null);
  status = 200;
  assert.deepEqual(await registryPackage("@nordix-tech/nordixgen", "0.1.15"), {
    version: "0.1.15",
  });
  for (status of [403, 429, 500])
    await assert.rejects(
      registryPackage("@nordix-tech/nordixgen", "0.1.15"),
      /npm registry returned/,
    );
});

test("an older retry must not move latest backwards across patch, minor or major releases", () => {
  assert.equal(compareVersions("0.1.10", "0.1.9"), 1);
  assert.equal(compareVersions("0.2.1", "0.1.999"), 1);
  assert.equal(compareVersions("1.0.1", "0.99.999"), 1);
  assert.equal(compareVersions("0.1.9", "0.1.10"), -1);
  assert.equal(compareVersions("0.1.10", "0.1.10"), 0);
});

test("a partial release is reusable only when version, source, workflow and tarball match", () => {
  const plan = { version: "0.1.15", commit: "abc", runId: "123" };
  const manifest = {
    name: "example",
    version: plan.version,
    nordixgenRelease: { commit: plan.commit, runId: plan.runId },
    dist: { integrity: "sha512-example" },
  };
  verifyPublished(manifest, plan, "sha512-example");
  for (const field of ["version", "commit", "runId"]) {
    const other = structuredClone(manifest);
    if (field === "version") other.version = "0.1.16";
    else other.nordixgenRelease[field] = "different";
    assert.throws(() => verifyPublished(other, plan, "sha512-example"));
  }
  assert.throws(() => verifyPublished(manifest, plan, "sha512-changed"));
});
