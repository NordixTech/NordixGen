import { posix } from "node:path";
import ts from "typescript";
/** Execute unchanged generated modules with explicit external boundary bindings. */
export function generatedRuntime(
  files: Readonly<Record<string, string>>,
  external: Readonly<Record<string, unknown>> = {},
) {
  const cache = new Map<string, Record<string, unknown>>();
  function load(path: string): Record<string, unknown> {
    if (Object.hasOwn(external, path)) return external[path] as Record<string, unknown>;
    const existing = cache.get(path);
    if (existing) return existing;
    const source = files[path];
    if (source === undefined) throw new Error(`Missing generated runtime module: ${path}`);
    const module = { exports: {} as Record<string, unknown> };
    cache.set(path, module.exports);
    const compiled = ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText;
    new Function("module", "exports", "require", compiled)(
      module,
      module.exports,
      (specifier: string) =>
        load(
          specifier.startsWith(".")
            ? posix.normalize(posix.join(posix.dirname(path), specifier)).replace(/\.js$/, ".ts")
            : specifier,
        ),
    );
    return module.exports;
  }
  return load;
}
