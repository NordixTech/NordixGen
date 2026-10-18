import type { GeneratedFile } from "../contracts.js";
import type { FrontendRenderContext } from "../frontend-contracts.js";
import { themeTokens } from "./theme-tokens.js";

export function generateTailwindFiles(context: FrontendRenderContext): readonly GeneratedFile[] {
  const root = context.framework.codeRoot;
  const light = themeTokens(context.frontend.theme.light);
  const dark = themeTokens(context.frontend.theme.dark);
  const declarations = (tokens: Readonly<Record<string, string>>) =>
    Object.entries(tokens)
      .map(([key, value]) => `  --ng-${key}: ${value};`)
      .join("\n");
  const aliases = Object.keys(light)
    .map((key) => `  --color-${key}: var(--ng-${key});`)
    .join("\n");
  return [
    {
      path: `${root}/styles/theme.css`,
      content: `:root {\n${declarations(light)}\n${aliases}\n  color-scheme: light;\n  --ng-radius: 1.25rem;\n}\n[data-theme="dark"] {\n${declarations(dark)}\n  color-scheme: dark;\n}\n@media (prefers-color-scheme: dark) {\n  :root:not([data-theme]), :root[data-theme="system"] {\n${declarations(dark)}\n    color-scheme: dark;\n  }\n}\n`,
    },
    {
      path: `${root}/app/globals.css`,
      content: `@import "tailwindcss";
@import "../styles/theme.css";
@import "../styles/ui.css";

@theme inline {
${aliases}
  --radius-card: 1.25rem;
}

* { box-sizing: border-box; }
body { margin: 0; background: var(--color-background); color: var(--color-foreground); }
a { color: inherit; text-decoration: none; }
`,
    },
    {
      path: `${context.framework.applicationRoot}/postcss.config.mjs`,
      content: `const config = { plugins: { "@tailwindcss/postcss": {} } };\nexport default config;\n`,
    },
  ];
}
