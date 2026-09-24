import { dirname, join, resolve } from 'node:path';
import fs from 'fs-extra';

export class VirtualFileSystem {
  private files = new Map<string, string>();

  /**
   * Sets or overwrites the content of a file at the given relative path.
   */
  write(relativePath: string, content: string): void {
    const normalizedPath = this.normalizePath(relativePath);
    this.files.set(normalizedPath, content);
  }

  /**
   * Reads the content of a file from the VFS.
   */
  read(relativePath: string): string | undefined {
    const normalizedPath = this.normalizePath(relativePath);
    return this.files.get(normalizedPath);
  }

  /**
   * Checks if a file exists in the VFS.
   */
  exists(relativePath: string): boolean {
    const normalizedPath = this.normalizePath(relativePath);
    return this.files.has(normalizedPath);
  }

  /**
   * Deletes a file from the VFS.
   */
  delete(relativePath: string): boolean {
    const normalizedPath = this.normalizePath(relativePath);
    return this.files.delete(normalizedPath);
  }

  /**
   * Merges JSON objects in a file (e.g. package.json, tsconfig.json).
   * If the file does not exist, starts with an empty object.
   */
  mergeJson(
    relativePath: string,
    updater: (current: Record<string, unknown>) => Record<string, unknown>,
  ): void {
    const currentRaw = this.read(relativePath);
    let currentObj: Record<string, unknown> = {};

    if (currentRaw) {
      try {
        currentObj = JSON.parse(currentRaw);
      } catch {
        currentObj = {};
      }
    }

    const updatedObj = updater(currentObj);
    this.write(relativePath, `${JSON.stringify(updatedObj, null, 2)}\n`);
  }

  /**
   * Appends text to an existing file, or creates it if it doesn't exist.
   */
  append(relativePath: string, contentToAppend: string): void {
    const current = this.read(relativePath) || '';
    this.write(relativePath, current + contentToAppend);
  }

  /**
   * Returns all relative file paths currently stored in the VFS.
   */
  listFiles(): string[] {
    return Array.from(this.files.keys()).sort();
  }

  /**
   * Clears all files in the VFS.
   */
  clear(): void {
    this.files.clear();
  }

  /**
   * Writes all files from memory to the physical disk.
   */
  async dumpToDisk(targetDirectory: string): Promise<void> {
    const resolvedTarget = resolve(targetDirectory);
    await fs.ensureDir(resolvedTarget);

    for (const [relativePath, content] of this.files.entries()) {
      const fullPath = join(resolvedTarget, relativePath);
      await fs.ensureDir(dirname(fullPath));
      await fs.writeFile(fullPath, content, 'utf-8');
    }
  }

  private normalizePath(path: string): string {
    return path.replace(/\\/g, '/').replace(/^\/+/, '');
  }
}
