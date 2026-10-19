import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["esm"],
    banner: {
      js: "#!/usr/bin/env node",
    },
    dts: { compilerOptions: { composite: false } },
    clean: false,
    sourcemap: true,
  },
  {
    entry: { "cicd-assistant": "src/cicd-assistant.ts" },
    format: ["esm"],
    banner: {
      js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
    },
    noExternal: [/.*/],
    dts: false,
    clean: false,
    sourcemap: false,
  },
]);
