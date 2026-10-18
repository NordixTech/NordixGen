import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

/** Compile real generated modules; framework-only declarations can be supplied at external boundaries. */
export async function generatedTypeErrors(
  files: Readonly<Record<string, string>>,
  options: ts.CompilerOptions = {},
  supportingFiles: Readonly<Record<string, string>> = {},
): Promise<string[]> {
  const parent = fileURLToPath(new URL("../", import.meta.url));
  const directory = await mkdtemp(join(parent, ".nordixgen-contract-types-"));
  const absolute = resolve(directory);
  if (!absolute.startsWith(`${resolve(parent)}${sep}.nordixgen-contract-types-`))
    throw new Error("Unsafe generated-typecheck cleanup path");
  try {
    await writeFile(join(directory, "package.json"), '{"type":"module"}\n');
    const sources = { ...files, ...supportingFiles };
    for (const [name, source] of Object.entries(sources)) {
      const target = resolve(directory, name);
      if (!target.startsWith(`${resolve(directory)}${sep}`))
        throw new Error("Generated typecheck path escapes its temporary project");
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, source);
    }
    const program = ts.createProgram(
      Object.keys(sources).map((name) => join(directory, name)),
      {
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.NodeNext,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
        jsx: ts.JsxEmit.Preserve,
        baseUrl: directory,
        typeRoots: [join(parent, "node_modules/@types")],
        paths: { "@/*": ["./*"] },
        ...options,
      },
    );
    return ts
      .getPreEmitDiagnostics(program)
      .map(
        (error) =>
          `${error.file ? relative(directory, error.file.fileName) : ""}: ${ts.flattenDiagnosticMessageText(error.messageText, "\n")}`,
      );
  } finally {
    await rm(absolute, { recursive: true, force: true });
  }
}
