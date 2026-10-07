import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";

export interface VfsEmissionResult {
  created: string[];
  updated: string[];
  unchanged: string[];
}

function normalizeVirtualPath(filePath: string): string {
  if (filePath.length === 0 || filePath.includes("\0") || filePath.includes("\\")) {
    throw new Error(
      "Virtual file paths must be non-empty POSIX paths without null bytes or backslashes.",
    );
  }
  if (isAbsolute(filePath) || /^[A-Za-z]:/.test(filePath)) {
    throw new Error(`Virtual file path must be relative: "${filePath}".`);
  }
  const segments = filePath.split("/").filter((segment) => segment.length > 0 && segment !== ".");
  if (segments.includes(".."))
    throw new Error(`Virtual file path cannot traverse upward: "${filePath}".`);
  const normalized = segments.join("/");
  if (normalized.length === 0) throw new Error("Virtual file path must identify a file.");
  return normalized;
}

export class VirtualFileSystem {
  private readonly files = new Map<string, string>();

  writeFile(filePath: string, content: string): void {
    this.files.set(normalizeVirtualPath(filePath), content);
  }

  readFile(filePath: string): string | undefined {
    return this.files.get(normalizeVirtualPath(filePath));
  }

  hasFile(filePath: string): boolean {
    return this.files.has(normalizeVirtualPath(filePath));
  }

  deleteFile(filePath: string): boolean {
    return this.files.delete(normalizeVirtualPath(filePath));
  }

  listFiles(): string[] {
    return [...this.files.keys()].sort((left, right) => left.localeCompare(right));
  }

  snapshot(): Record<string, string> {
    return Object.fromEntries(
      this.listFiles().map((filePath) => [filePath, this.files.get(filePath) as string]),
    );
  }

  async emit(rootDirectory: string): Promise<VfsEmissionResult> {
    await mkdir(rootDirectory, { recursive: true });
    const root = await realpath(rootDirectory);
    const result: VfsEmissionResult = { created: [], updated: [], unchanged: [] };

    for (const filePath of this.listFiles()) {
      const targetPath = resolve(root, ...filePath.split("/"));
      await mkdir(dirname(targetPath), { recursive: true });

      let previousContent: string | undefined;
      try {
        previousContent = await readFile(targetPath, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }

      const content = this.files.get(filePath) as string;
      if (previousContent === content) {
        result.unchanged.push(filePath);
      } else {
        await writeFile(targetPath, content, "utf8");
        (previousContent === undefined ? result.created : result.updated).push(filePath);
      }
    }

    return result;
  }
}

export { normalizeVirtualPath };
