import { execa } from 'execa';

export interface GitInitResult {
  initialized: boolean;
  branch: string;
  error?: string;
}

export async function initGitRepository(
  targetDirectory: string,
  defaultBranch = 'main',
): Promise<GitInitResult> {
  try {
    // 1. git init
    await execa('git', ['init'], { cwd: targetDirectory });

    // 2. set default branch
    await execa('git', ['branch', '-M', defaultBranch], { cwd: targetDirectory });

    // 3. git add .
    await execa('git', ['add', '.'], { cwd: targetDirectory });

    // 4. initial commit
    await execa('git', ['commit', '-m', 'feat: initial project boilerplate by NordixGen'], {
      cwd: targetDirectory,
    });

    return {
      initialized: true,
      branch: defaultBranch,
    };
  } catch (error) {
    return {
      initialized: false,
      branch: defaultBranch,
      error: error instanceof Error ? error.message : 'Failed to initialize Git repository',
    };
  }
}
