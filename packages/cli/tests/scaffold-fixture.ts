import { mkdir, writeFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
export async function fixtureCommand(file: string, args: string[], cwd: string): Promise<string> {
  if (file === "pnpm" && args[0] === "--version") return "10.5.2";
  if (
    file === "pnpm" &&
    (args[1]?.startsWith("hono@") || args[1]?.startsWith("create-next-app@"))
  ) {
    const target = resolve(cwd, args[2]);
    const rel = relative(cwd, target);
    if (rel === ".." || rel.startsWith(`..${sep}`)) throw Error("Unsafe fixture scaffold target");
    await mkdir(join(target, "src"), { recursive: true });
    await writeFile(
      join(target, "package.json"),
      JSON.stringify({
        name: "upstream",
        scripts: { dev: args[1].startsWith("hono@") ? "wrangler dev" : "next dev" },
        dependencies: args[1].startsWith("hono@")
          ? { hono: "^4.0.0" }
          : { next: "15.5.26", react: "19.1.1", "react-dom": "19.1.1" },
      }),
    );
    await writeFile(join(target, "tsconfig.json"), '{"compilerOptions":{"strict":true}}');
  }
  return "";
}
