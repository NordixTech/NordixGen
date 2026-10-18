import type { GeneratedFile } from "../contracts.js";
import type { FrontendRenderContext } from "../frontend-contracts.js";
import { themeInitializationScript } from "./theme.js";
/** Sole owner of the fixed Query/Zustand/identity shell. */
export function generateFrontendShell(context: FrontendRenderContext): readonly GeneratedFile[] {
  const root = context.framework.codeRoot;
  const auth = Boolean(context.api.authentication);
  return [
    {
      path: `${root}/app/providers.tsx`,
      content: [
        '"use client";',
        'import {useEffect,useState,type ReactNode} from "react";',
        'import {QueryClientProvider} from "@tanstack/react-query";',
        'import {createSessionQueryCache} from "@/lib/api/cache";',
        'import {Toaster} from "@/components/ui/toaster";',
        'import {initializeTheme} from "@/stores/theme-store";',
        ...(auth
          ? [
              'import {useSessionView} from "@/lib/auth/use-session-view";',
              'import {sessionCacheIdentity} from "@/lib/api/cache";',
            ]
          : []),
        "function QueryScope({children}:{children:ReactNode}) {",
        " const [cache]=useState(createSessionQueryCache);",
        " useEffect(()=>()=>cache.dispose(),[cache]);",
        " return <QueryClientProvider client={cache.client}>{children}<Toaster /></QueryClientProvider>;",
        "}",
        "export function Providers({children}:{children:ReactNode}) {",
        " useEffect(initializeTheme,[]);",
        ...(auth
          ? [
              " const session=useSessionView();",
              " const identity=sessionCacheIdentity(session);",
              " return <QueryScope key={identity}>{children}</QueryScope>;",
            ]
          : [" return <QueryScope>{children}</QueryScope>;"]),
        "}",
        "",
      ].join("\n"),
    },
    {
      path: `${root}/app/layout.tsx`,
      content: [
        'import type {Metadata} from "next";',
        'import Link from "next/link";',
        'import type {ReactNode} from "react";',
        'import "./globals.css";',
        'import {Providers} from "./providers";',
        'import {ThemeSwitcher} from "@/components/ui/theme-switcher";',
        ...(auth ? ['import {AuthControls} from "@/components/auth/auth-controls";'] : []),
        `export const metadata:Metadata={title:${JSON.stringify(context.projectName)},description:"Generated with NordixGen"};`,
        "export default function RootLayout({children}:{children:ReactNode}) {",
        `return <html lang="en" data-theme=${JSON.stringify(context.frontend.theme.default)} suppressHydrationWarning><head><script dangerouslySetInnerHTML={{__html:${JSON.stringify(themeInitializationScript(context.frontend.theme.default))}}}/></head><body><Providers><header className="ng-topbar ng-app-topbar"><Link className="ng-brand" href="/" aria-label="NordixGen home"><span aria-hidden="true" className="ng-brand-mark">N</span><span>Nordix<span className="ng-brand-accent">Gen</span></span></Link><div className="ng-topbar-actions"><ThemeSwitcher/>${auth ? "<AuthControls />" : ""}</div></header>{children}</Providers></body></html>;`,
        "}",
        "",
      ].join("\n"),
    },
  ];
}
