import { execa } from "execa";

export type CommandRunner = (file: string, args: string[], cwd: string) => Promise<string>;

export function safeFailure(error: unknown): string {
  let message = error instanceof Error ? error.message : String(error);
  for (const [name, value] of Object.entries(process.env))
    if (value && value.length >= 6 && /TOKEN|SECRET|PASSWORD|API_KEY/i.test(name))
      message = message.replaceAll(value, "[redacted]");
  return message
    .replace(/\b(https?|postgres(?:ql)?):\/\/[^\s/@]+(?::[^\s/@]*)?@/gi, "$1://[redacted]@")
    .replace(/\b(Bearer)\s+[^\s,;]+/gi, "$1 [redacted]")
    .replace(/\b(token|password|secret|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]");
}
export async function checkedCommand(
  runner: CommandRunner,
  file: string,
  args: string[],
  cwd: string,
  stage: string,
): Promise<string> {
  try {
    return await runner(file, args, cwd);
  } catch (error) {
    throw Error(`${stage}: ${safeFailure(error)}`);
  }
}

export const runCommand: CommandRunner = async (file, args, cwd) => {
  const result = await execa(file, args, {
    cwd,
    reject: false,
    stdin: "ignore",
    env: { GIT_TERMINAL_PROMPT: "0", GH_PROMPT_DISABLED: "1" },
  });
  if (result.exitCode !== 0) {
    const detail =
      [result.stderr.trim(), result.stdout.trim()].filter(Boolean).join("\n") ||
      `exit code ${result.exitCode}`;
    throw new Error(`${file} ${args[0] ?? ""} failed: ${safeFailure(detail)}`);
  }
  return result.stdout.trim();
};
