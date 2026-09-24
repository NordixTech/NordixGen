import { resolve } from 'node:path';
import { execa } from 'execa';
import type { VirtualFileSystem } from '../vfs/index.js';

export interface WriteProjectOptions {
  format?: boolean;
}

export async function writeProjectToDisk(
  vfs: VirtualFileSystem,
  targetDirectory: string,
  options: WriteProjectOptions = {},
): Promise<{ targetPath: string; fileCount: number }> {
  const targetPath = resolve(targetDirectory);
  const fileCount = vfs.listFiles().length;

  await vfs.dumpToDisk(targetPath);

  if (options.format) {
    try {
      // Attempt formatting with biome or prettier if available
      await execa('npx', ['--yes', '@biomejs/biome', 'format', '--write', '.'], {
        cwd: targetPath,
        stdio: 'ignore',
      });
    } catch {
      // Graceful fallback if formatter fails or is offline
    }
  }

  return { targetPath, fileCount };
}
