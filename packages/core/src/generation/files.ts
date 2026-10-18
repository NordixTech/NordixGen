import type { GeneratedFile } from "../plugins/contracts.js";
import { VirtualFileSystem, normalizeVirtualPath } from "../virtual-file-system.js";
/** Prepare the complete collection before any emission. Equal content still has one owner. */
export function collectFiles(
  applicationRoot: string,
  contributions: readonly { owner: string; files: readonly GeneratedFile[] }[],
): VirtualFileSystem {
  const root = applicationRoot === "." ? "" : normalizeVirtualPath(applicationRoot);
  const owners = new Map<string, string>();
  const vfs = new VirtualFileSystem();
  for (const contribution of contributions)
    for (const file of contribution.files) {
      const path = normalizeVirtualPath(file.path);
      if (root && !path.startsWith(`${root}/`))
        throw new Error(
          `GENERATED_FILE_PATH_INVALID: "${path}" from "${contribution.owner}" escapes application "${root}". Fix the generator path; no files were emitted.`,
        );
      const key = path.toLowerCase();
      const previous = owners.get(key);
      if (previous)
        throw new Error(
          `GENERATED_FILE_OWNER_CONFLICT: Both "${previous}" and "${contribution.owner}" attempted to generate "${path}". This is a NordixGen generator error. Render the shared file once using all required references. No generated files were emitted.`,
        );
      owners.set(key, contribution.owner);
      vfs.writeFile(path, file.content);
    }
  return vfs;
}
/** Only these known initial scaffold files may be replaced in a new/empty target. */
export const BACKEND_SCAFFOLD_OVERLAYS = ["src/index.ts", "wrangler.jsonc"] as const;
