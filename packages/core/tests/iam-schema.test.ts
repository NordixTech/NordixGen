import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { generateBackend } from "../src/generation/backend.js";
import { resolvedFixture, targetConfig } from "./fixtures.js";
import { generatedTypeErrors } from "./generated-types.js";

const root = "apps/api/src";
function output() {
  const config = targetConfig();
  // Permission tokens are not limited to resource:verb; preserve the existing YAML contract.
  config.endpoints[0].authRequired = true;
  config.endpoints[0].permissions.push("dashboard", "iam:report:read", "constructor", "__proto__");
  const result = generateBackend(resolvedFixture(config), "api");
  if (!result.success) throw Error("Invalid generated IAM fixture");
  return result;
}
describe("native IAM plugin contracts", () => {
  it("compiles the real plugin, schema and transactional handlers against pinned dependencies", async () => {
    const files = output().virtualFileSystem.snapshot();
    const selected = Object.fromEntries(
      Object.entries(files).filter(
        ([path]) =>
          path.endsWith(".ts") &&
          (path.includes("/platform/auth/") ||
            path.includes("/platform/authorization/") ||
            path.includes("/platform/database/schema/") ||
            path.endsWith("/platform/database/drizzle-database.ts") ||
            (path.includes("/modules/") &&
              (path.includes("/domain/") || path.includes("/infrastructure/database/schema/")))),
      ),
    );
    const fixture = `import {ac,isAuthorized} from "./platform/authorization/policy.js";
ac.newRole({customers:["read"]});
ac.newRole({iam:["roles:manage","users:manage-roles"]});
ac.newRole({dashboard:["access"]});
ac.newRole({["$__proto__"]:["access"]});
// @ts-expect-error unknown resource
ac.newRole({invented:["read"]});
// @ts-expect-error misspelled permission
ac.newRole({customers:["raed"]});
// @ts-expect-error unknown operation permission
isAuthorized({permissions:["*"]},{permissions:["customers:raed"]});
`;
    expect(
      await generatedTypeErrors({ ...selected, [`${root}/iam-contract.ts`]: fixture }),
    ).toEqual([]);
  }, 20000);
  it("lets the official Better Auth CLI discover both IAM tables, their unique grants and the user role", async () => {
    const parent = fileURLToPath(new URL("../", import.meta.url));
    const directory = await mkdtemp(join(parent, ".nordixgen-contract-types-"));
    if (!resolve(directory).startsWith(`${resolve(parent)}${sep}.nordixgen-contract-types-`))
      throw Error("Unsafe IAM schema test path");
    try {
      await output().virtualFileSystem.emit(directory);
      const app = join(directory, "apps/api");
      await writeFile(join(app, "package.json"), '{"type":"module"}');
      const generated = join(app, "discovered-schema.ts");
      const result = spawnSync(
        process.execPath,
        [
          join(parent, "node_modules/auth/dist/index.mjs"),
          "generate",
          "--config",
          join(app, "src/platform/auth/schema.config.ts"),
          "--output",
          generated,
          "--yes",
        ],
        {
          cwd: app,
          encoding: "utf8",
          windowsHide: true,
          env: { ...process.env, DO_NOT_TRACK: "1" },
        },
      );
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      const schema = await readFile(generated, "utf8");
      expect(schema).toContain('"auth_roles"');
      expect(schema).toContain('"auth_role_permissions"');
      expect(schema).toContain('"role_id"');
      expect(schema).toContain('"is_system"');
      expect(schema).toMatch(/(?:unique|uniqueIndex)[\s\S]*role_id[\s\S]*permission/);
      expect(schema).not.toContain("auth_iam_audit");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 30000);
});
