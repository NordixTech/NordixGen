import type { GeneratedFile } from "../contracts.js";
import type { FrontendRenderContext } from "../frontend-contracts.js";
/** Sole owner of the fixed Query/Zustand/identity shell. */
export function generateFrontendShell(context: FrontendRenderContext): readonly GeneratedFile[] {
  const root = context.framework.codeRoot;
  const auth = Boolean(context.api.authentication);
  return [
    {
      path: `${root}/app/providers.tsx`,
      content: [
        '"use client";',
        'import {useState,type ReactNode} from "react";',
        'import {QueryClient,QueryClientProvider} from "@tanstack/react-query";',
        'import {Toaster} from "@/components/ui/toaster";',
        ...(auth ? ['import {SessionViewSync} from "@/components/auth/session-view-sync";'] : []),
        "export function Providers({children}:{children:ReactNode}) {",
        " const [client]=useState(()=>new QueryClient());",
        ` return <QueryClientProvider client={client}>${auth ? "<SessionViewSync />" : ""}{children}<Toaster /></QueryClientProvider>;`,
        "}",
        "",
      ].join("\n"),
    },
    {
      path: `${root}/app/layout.tsx`,
      content: [
        'import type {Metadata} from "next";',
        'import type {ReactNode} from "react";',
        'import "./globals.css";',
        'import {Providers} from "./providers";',
        ...(auth ? ['import {AuthControls} from "@/components/auth/auth-controls";'] : []),
        `export const metadata:Metadata={title:${JSON.stringify(context.projectName)},description:"Generated with NordixGen"};`,
        "export default function RootLayout({children}:{children:ReactNode}) {",
        `return <html lang="en"><body><Providers>${auth ? '<div className="ng-session-indicator"><AuthControls /></div>' : ""}{children}</Providers></body></html>;`,
        "}",
        "",
      ].join("\n"),
    },
  ];
}
