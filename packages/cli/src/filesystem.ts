import { access, lstat, readdir } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
export function inside(root: string, path: string): string {
  const target = resolve(root, path);
  const rel = relative(root, target);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel))
    throw Error("Output path escapes its repository. Correct the configured application path.");
  return target;
}
export async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return false;
  }
}
export async function rejectLinks(path: string): Promise<void> {
  let current = resolve(path);
  while (true) {
    try {
      if ((await lstat(current)).isSymbolicLink())
        throw Error("Output paths must not contain symbolic links. Choose a new real directory.");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const parent = dirname(current);
    if (parent === current) return;
    current = parent;
  }
}
export async function ensureNewOrEmpty(root: string): Promise<void> {
  await rejectLinks(root);
  if (!(await exists(root))) return;
  if (!(await lstat(root)).isDirectory())
    throw Error("The output destination must be a new or empty directory, not a file.");
  if ((await readdir(root)).length)
    throw Error("Generation requires a new or empty output directory. Choose another destination.");
}
export async function existingParent(path: string): Promise<string> {
  let current = resolve(path);
  while (!(await exists(current))) current = dirname(current);
  return current;
}
