import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { VirtualFileSystem, normalizeVirtualPath } from "../src/virtual-file-system.js";

const temporaryDirectories: string[] = [];

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "nordixgen-vfs-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("deterministic virtual file system", () => {
  it("normalizes safe paths and rejects absolute or traversing paths", () => {
    expect(normalizeVirtualPath("./src//domain/User.ts")).toBe("src/domain/User.ts");
    for (const path of [
      "",
      "file\0name",
      "src\\file.ts",
      "/absolute/file",
      "C:/absolute/file",
      "../outside",
      "./",
    ])
      expect(() => normalizeVirtualPath(path)).toThrow();
  });

  it("supports stable writes, reads, snapshots, listings, and deletion", () => {
    const vfs = new VirtualFileSystem();
    vfs.writeFile("z/file.ts", "z");
    vfs.writeFile("a/file.ts", "a");
    vfs.writeFile("a/file.ts", "updated");
    expect(vfs.readFile("a/file.ts")).toBe("updated");
    expect(vfs.readFile("missing.ts")).toBeUndefined();
    expect(vfs.hasFile("z/file.ts")).toBe(true);
    expect(vfs.hasFile("missing.ts")).toBe(false);
    expect(vfs.listFiles()).toEqual(["a/file.ts", "z/file.ts"]);
    expect(vfs.snapshot()).toEqual({ "a/file.ts": "updated", "z/file.ts": "z" });
    expect(vfs.deleteFile("a/file.ts")).toBe(true);
    expect(vfs.deleteFile("a/file.ts")).toBe(false);
  });

  it("emits files and skips identical contents on repeat runs", async () => {
    const root = await createTemporaryDirectory();
    const vfs = new VirtualFileSystem();
    vfs.writeFile("src/main.ts", "export const value = 1;\n");
    vfs.writeFile("README.md", "# Generated\n");
    const first = await vfs.emit(root);
    expect(first.created).toEqual(["README.md", "src/main.ts"]);
    expect(first.updated).toEqual([]);
    expect(first.unchanged).toEqual([]);
    expect(await readFile(join(root, "src/main.ts"), "utf8")).toBe("export const value = 1;\n");
    expect(await vfs.emit(root)).toEqual({
      created: [],
      updated: [],
      unchanged: ["README.md", "src/main.ts"],
    });

    vfs.writeFile("src/main.ts", "export const value = 2;\n");
    const third = await vfs.emit(root);
    expect(third.updated).toEqual(["src/main.ts"]);
    expect(third.unchanged).toEqual(["README.md"]);
  });

  it("propagates filesystem errors other than a missing output file", async () => {
    const root = await createTemporaryDirectory();
    await mkdir(join(root, "collision"));
    const vfs = new VirtualFileSystem();
    vfs.writeFile("collision", "not a directory");
    await expect(vfs.emit(root)).rejects.toThrow();
  });
});
