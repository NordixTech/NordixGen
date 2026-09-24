import { initGitRepository } from '../core/git/index.js';
import { buildNordixIr } from '../core/ir/builder.js';
import type { NordixIr } from '../core/ir/types.js';
import { checkCompatibility } from '../core/matrix/compatibility.js';
import type { NordixConfig } from '../core/schema/nordix.schema.js';
import { VirtualFileSystem } from '../core/vfs/index.js';
import { writeProjectToDisk } from '../core/writer/index.js';
import { generateHonoBackend } from './backend/hono/index.js';
import { generateNextjsFrontend } from './frontend/nextjs/index.js';
import { generateInfraAndRoot } from './infra/environment.js';

export interface GenerateProjectOptions {
  targetDirectory: string;
  git?: boolean;
  format?: boolean;
}

export interface GenerateProjectResult {
  success: boolean;
  targetDirectory: string;
  fileCount: number;
  files: string[];
  warnings: string[];
  errors: string[];
  gitInitialized: boolean;
  ir?: NordixIr;
}

export async function generateProject(
  config: NordixConfig,
  options: GenerateProjectOptions,
): Promise<GenerateProjectResult> {
  // 1. Check compatibility matrix
  const compat = checkCompatibility(config);
  if (!compat.isValid) {
    return {
      success: false,
      targetDirectory: options.targetDirectory,
      fileCount: 0,
      files: [],
      warnings: compat.warnings,
      errors: compat.errors,
      gitInitialized: false,
    };
  }

  // 2. Build IR (Semantic Graph)
  const ir = buildNordixIr(config);
  const vfs = new VirtualFileSystem();

  const isMonorepo = config.structure === 'monorepo';
  const apiPath = isMonorepo ? 'apps/api' : 'api';
  const webPath = isMonorepo ? 'apps/web' : 'web';

  // 3. Generate Backend (Hono Golden Path)
  if (config.backend.framework === 'hono') {
    generateHonoBackend(ir, vfs, apiPath);
  }

  // 4. Generate Frontend (Next.js Golden Path)
  if (config.frontend.framework === 'nextjs') {
    generateNextjsFrontend(ir, vfs, webPath);
  }

  // 5. Generate Infrastructure, Docker & Workspace Root
  generateInfraAndRoot(ir, vfs);

  // 6. Write VFS to physical disk
  const { fileCount } = await writeProjectToDisk(vfs, options.targetDirectory, {
    format: options.format ?? false,
  });

  // 7. Git Initialization
  let gitInitialized = false;
  if (options.git !== false) {
    const gitRes = await initGitRepository(options.targetDirectory);
    gitInitialized = gitRes.initialized;
  }

  return {
    success: true,
    targetDirectory: options.targetDirectory,
    fileCount,
    files: vfs.listFiles(),
    warnings: compat.warnings,
    errors: [],
    gitInitialized,
    ir,
  };
}
