import { generatedRuntime } from "./generated-runtime.js";
/** Resolve the generated Next alias while keeping every generated module unchanged. */
export function frontendRuntime(
  files: Readonly<Record<string, string>>,
  root: string,
  external: Readonly<Record<string, unknown>> = {},
  globals: Readonly<Record<string, unknown>> = {},
) {
  const aliases = Object.fromEntries(
    Object.entries(files)
      .filter(([name]) => name.startsWith(`${root}/`))
      .map(([name, content]) => [`@/${name.slice(root.length + 1)}`, content]),
  );
  return generatedRuntime({ ...files, ...aliases }, external, globals);
}
