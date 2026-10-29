import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

export default defineConfig([
  {
    entry: ["src/index.ts"],
    define: { "process.env.NORDIXGEN_PACKAGE_VERSION": JSON.stringify(version) },
    format: ["esm"],
    banner: {
      js: "#!/usr/bin/env node",
    },
    dts: { compilerOptions: { composite: false } },
    clean: false,
    sourcemap: true,
  },
  {
    entry: {
      "cicd-assistant": "src/cicd-assistant.ts",
      "infrastructure-runner": "src/infrastructure-entry.ts",
    },
    format: ["esm"],
    banner: {
      js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
    },
    noExternal: [/.*/],
    splitting: false,
    dts: false,
    clean: false,
    sourcemap: false,
  },
]);
