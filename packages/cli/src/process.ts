import { execa } from "execa";

export type CommandRunner = (file: string, args: string[], cwd: string) => Promise<string>;

export const runCommand: CommandRunner = async (file, args, cwd) => {
  const result = await execa(file, args, { cwd, reject: false });
  if (result.exitCode !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || `exit code ${result.exitCode}`;
    throw new Error(`${file} ${args[0] ?? ""} failed: ${detail}`);
  }
  return result.stdout.trim();
};
