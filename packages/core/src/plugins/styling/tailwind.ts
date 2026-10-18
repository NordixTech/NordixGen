import type { GeneratedFile } from "../contracts.js";
import type { FrontendRenderContext } from "../frontend-contracts.js";

export function generateTailwindFiles(context: FrontendRenderContext): readonly GeneratedFile[] {
  const root = context.framework.codeRoot;
  return [
    {
      path: `${root}/app/globals.css`,
      content: `@import "tailwindcss";
@import "../styles/ui.css";

@theme {
  --color-background: #f6f8fb;
  --color-foreground: #101828;
  --color-primary: #155eef;
  --color-primary-foreground: #ffffff;
  --color-muted: #667085;
  --color-surface: #ffffff;
  --color-border: #e4e7ec;
  --radius-card: 1.25rem;
}

:root {
  color-scheme: light;
  --ng-background: #f6f8fb;
  --ng-foreground: #101828;
  --ng-primary: #155eef;
  --ng-primary-foreground: #ffffff;
  --ng-muted: #667085;
  --ng-surface: #ffffff;
  --ng-border: #e4e7ec;
  --ng-radius: 1.25rem;
}

* { box-sizing: border-box; }
body { margin: 0; background: var(--ng-background); color: var(--ng-foreground); }
a { color: inherit; text-decoration: none; }
`,
    },
    {
      path: `${root}/postcss.config.mjs`,
      content: `export default {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};
`,
    },
  ];
}
