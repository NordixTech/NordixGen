import type { FrontendGeneratorPlugin } from "../frontend-contracts.js";

export const plainCssStylingPlugin: FrontendGeneratorPlugin = {
  descriptor: {
    id: "css",
    version: "1.0.0",
    role: "styling",
    provides: ["styling:plain-css"],
    requires: [
      {
        capability: "framework:react",
        description: "The generated CSS UI primitives currently require a React-based framework.",
      },
    ],
  },
  contribute(context) {
    return [
      {
        path: `${context.framework.codeRoot}/app/globals.css`,
        content: `@import "../styles/ui.css";

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
    ];
  },
};
