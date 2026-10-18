import { posix } from "node:path";
import ts from "typescript";
/** Execute unchanged generated modules with explicit external boundary bindings. */
export function generatedRuntime(
  files: Readonly<Record<string, string>>,
  external: Readonly<Record<string, unknown>> = {},
  globals: Readonly<Record<string, unknown>> = {},
) {
  const cache = new Map<string, Record<string, unknown>>();
  function load(request: string): Record<string, unknown> {
    let path = request;
    if (Object.hasOwn(external, path)) return external[path] as Record<string, unknown>;
    if (!Object.hasOwn(files, path)) {
      if (Object.hasOwn(files, `${path}.ts`)) path += ".ts";
      else if (Object.hasOwn(files, `${path}.tsx`)) path += ".tsx";
    }
    const existing = cache.get(path);
    if (existing) return existing;
    const source = files[path];
    if (source === undefined) throw new Error(`Missing generated runtime module: ${path}`);
    const module = { exports: {} as Record<string, unknown> };
    cache.set(path, module.exports);
    const compiled = ts
      .transpileModule(source, {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
      })
      .outputText.replaceAll("import.meta.url", JSON.stringify(`file:///${path}`));
    new Function("module", "exports", "require", ...Object.keys(globals), compiled)(
      module,
      module.exports,
      (specifier: string) =>
        load(
          specifier.startsWith(".")
            ? posix.normalize(posix.join(posix.dirname(path), specifier)).replace(/\.js$/, ".ts")
            : specifier,
        ),
      ...Object.values(globals),
    );
    return module.exports;
  }
  return load;
}
