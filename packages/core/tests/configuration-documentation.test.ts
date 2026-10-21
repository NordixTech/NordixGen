import { execFileSync } from "node:child_process";
import { access, readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { parseDocument } from "yaml";

const documentation = fileURLToPath(new URL("../../../docs/configuration/", import.meta.url));
const specification = resolve(documentation, "YAML_V2.md");

describe("configuration design documentation", () => {
  it("versions only example YAML sources while ignoring generated trees and credentials", () => {
    const paths = [
      "examples/performance/project.yaml",
      "examples/future/nested/project.yml",
      "examples/performance/generated/project.yaml",
      "examples/performance/generated/apps/api/src/index.ts",
      "examples/performance/state.secret.json",
      "examples/performance/.env.yaml",
    ];
    const ignored = execFileSync("git", ["check-ignore", "--no-index", "--stdin"], {
      cwd: resolve(documentation, "../.."),
      input: paths.join("\n"),
      encoding: "utf8",
    })
      .trim()
      .split(/\r?\n/);
    expect(ignored).toEqual(paths.slice(2));
  });
  it("keeps full YAML examples and invalid-edit snippets syntactically well formed", async () => {
    const examples = resolve(documentation, "../../examples/performance");
    const files = (await readdir(examples)).filter((name) => name.endsWith(".yaml")).sort();
    expect(files.length).toBeGreaterThan(0);
    const text = await readFile(specification, "utf8");
    for (const file of files) {
      const source = await readFile(resolve(examples, file), "utf8");
      const document = parseDocument(source, { uniqueKeys: true });
      expect(document.errors.map((error) => `${file}: ${error.message}`)).toEqual([]);
      // Samples describe YAML v2; semantic validation is covered separately.
      expect(document.get("schemaVersion")).toBe(2);
      expect(text).toContain(`examples/performance/${file}`);
    }
    const snippets = [...text.matchAll(/^```yaml\r?\n([\s\S]*?)^```/gm)];
    expect(snippets.length).toBeGreaterThan(0);
    for (const [, source] of snippets) {
      expect(parseDocument(source, { uniqueKeys: true }).errors).toEqual([]);
    }
  });

  it("resolves local specification, example and communication links", async () => {
    const root = resolve(documentation, "../..");
    const docs = await readdir(resolve(root, "docs"), { recursive: true });
    const files = [
      ...docs.filter((file) => file.endsWith(".md")).map((file) => resolve(root, "docs", file)),
      resolve(root, "README.md"),
      resolve(root, "packages/core/README.md"),
      resolve(root, "packages/cli/README.md"),
    ];
    for (const file of files) {
      const source = await readFile(file, "utf8");
      for (const [, link] of source.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
        if (!link || /^(?:https?:|#)/.test(link)) continue;
        await expect(
          access(resolve(dirname(file), link.split("#")[0] ?? "")),
        ).resolves.toBeUndefined();
      }
    }
  });

  it("typechecks the framework-independent public contracts and composition sketch", () => {
    const program = ts.createProgram([resolve(documentation, "module-communication.ts")], {
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
    });
    expect(
      ts
        .getPreEmitDiagnostics(program)
        .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")),
    ).toEqual([]);
  }, 15_000);
});
