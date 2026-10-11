import type { GeneratedFile } from "../contracts.js";
import type {
  FrontendPluginContributionContext,
  FrontendPluginRole,
} from "../frontend-contracts.js";

function source(lines: readonly string[]): string {
  return `${lines.join("\n")}\n`;
}

export function frontendRootShellOwnerRole(
  capabilities: ReadonlySet<string>,
): "server-state" | "client-state" | "authentication" | undefined {
  if (capabilities.has("server-state:tanstack-query")) return "server-state";
  if (capabilities.has("client-state:context") || capabilities.has("client-state:zustand")) {
    return "client-state";
  }
  if (capabilities.has("authentication:session")) return "authentication";
  return undefined;
}

export function frontendRootShellFiles(
  context: FrontendPluginContributionContext,
  role: Extract<FrontendPluginRole, "server-state" | "client-state" | "authentication">,
): readonly GeneratedFile[] {
  if (frontendRootShellOwnerRole(context.availableCapabilities) !== role) return [];
  const capabilities = context.availableCapabilities;
  const tanstack = capabilities.has("server-state:tanstack-query");
  const contextState = capabilities.has("client-state:context");
  const zustand = capabilities.has("client-state:zustand");
  const sessionSync = capabilities.has("authentication:session") && zustand;
  const toaster = contextState || zustand;
  const imports = [
    '"use client";',
    "",
    `import { type ReactNode${tanstack ? ", useState" : ""} } from "react";`,
  ];
  if (tanstack) {
    imports.push('import { QueryClient, QueryClientProvider } from "@tanstack/react-query";');
  }
  if (contextState) {
    imports.push('import { ClientStateProvider } from "@/stores/client-state-provider";');
  }
  if (sessionSync) {
    imports.push('import { SessionViewSync } from "@/components/auth/session-view-sync";');
  }
  if (toaster) imports.push('import { Toaster } from "@/components/ui/toaster";');

  let tree = "children";
  if (sessionSync && toaster) tree = "<><SessionViewSync />{children}<Toaster /></>";
  else if (toaster) tree = "<>{children}<Toaster /></>";
  if (contextState) tree = `<ClientStateProvider>${tree}</ClientStateProvider>`;
  if (tanstack) tree = `<QueryClientProvider client={queryClient}>${tree}</QueryClientProvider>`;

  const body = tanstack
    ? [
        "export function Providers({ children }: { children: ReactNode }) {",
        "  const [queryClient] = useState(() => new QueryClient());",
        `  return ${tree};`,
        "}",
      ]
    : [
        "export function Providers({ children }: { children: ReactNode }) {",
        `  return ${tree};`,
        "}",
      ];

  const root = context.framework.codeRoot;
  return [
    { path: `${root}/app/providers.tsx`, content: source([...imports, "", ...body]) },
    {
      path: `${root}/app/layout.tsx`,
      content: source([
        'import type { Metadata } from "next";',
        'import type { ReactNode } from "react";',
        'import "./globals.css";',
        'import { Providers } from "./providers";',
        "",
        `export const metadata: Metadata = { title: ${JSON.stringify(context.projectName)}, description: "Generated with NordixGen" };`,
        "",
        "export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {",
        '  return <html lang="en"><body><Providers>{children}</Providers></body></html>;',
        "}",
      ]),
    },
  ];
}
