import type { GeneratedFile } from "../contracts.js";
import type { FrontendRenderContext } from "../frontend-contracts.js";
import { dashboardShellFiles } from "./dashboard-shell.js";
import { themeInitializationScript } from "./theme.js";
/** Sole owner of the fixed Query/Zustand/identity shell. */
export function generateFrontendShell(context: FrontendRenderContext): readonly GeneratedFile[] {
  const root = context.framework.codeRoot;
  const auth = Boolean(context.api.authentication);
  return [
    ...dashboardShellFiles(context),
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
              'import {useSessionView,InitialIdentityProvider} from "@/lib/auth/use-session-view";',
              'import type {SessionUser} from "@/lib/auth/permissions";',
              'import {sessionCacheIdentity} from "@/lib/api/cache";',
            ]
          : []),
        "function QueryScope({children}:{children:ReactNode}) {",
        " const [cache]=useState(createSessionQueryCache);",
        " useEffect(()=>()=>cache.dispose(),[cache]);",
        " return <QueryClientProvider client={cache.client}>{children}<Toaster /></QueryClientProvider>;",
        "}",
        auth
          ? "function IdentityScope({children}:{children:ReactNode}) {"
          : "export function Providers({children}:{children:ReactNode}) {",
        " useEffect(initializeTheme,[]);",
        ...(auth
          ? [
              " const session=useSessionView();",
              " const identity=sessionCacheIdentity(session);",
              ' return <QueryScope key={identity}>{session.error?<div role="alert" className="ng-notice ng-notice--alert">{session.error}<button type="button" onClick={session.retry}>Try again</button></div>:children}</QueryScope>;',
            ]
          : [" return <QueryScope>{children}</QueryScope>;"]),
        "}",
        ...(auth
          ? [
              "export function Providers({children,initialUser}:{children:ReactNode;initialUser?:SessionUser|null}){return <InitialIdentityProvider user={initialUser}><IdentityScope>{children}</IdentityScope></InitialIdentityProvider>;}",
            ]
          : []),
        "",
      ].join("\n"),
    },
    {
      path: `${root}/app/layout.tsx`,
      content: [
        'import type {Metadata} from "next";',
        'import {AppShell} from "@/components/layout/app-shell";',
        'import type {ReactNode} from "react";',
        'import "./globals.css";',
        'import {Providers} from "./providers";',
        ...(auth ? ['import {getInitialIdentity} from "@/lib/auth/server";'] : []),
        ...(context.frontend.ai?.chat.enabled && context.frontend.ai.chat.placement === "floating"
          ? ['import {FloatingAssistant} from "@/components/ai/assistant-chat";']
          : []),
        `export const metadata:Metadata={title:${JSON.stringify(context.projectName)},description:"Generated with NordixGen"};`,
        `${auth ? "export default async" : "export default"} function RootLayout({children}:{children:ReactNode}) {`,
        ...(auth ? ["const initialUser=await getInitialIdentity();"] : []),
        `return <html lang="en" data-theme=${JSON.stringify(context.frontend.theme.default)} suppressHydrationWarning><head><script dangerouslySetInnerHTML={{__html:${JSON.stringify(themeInitializationScript(context.frontend.theme.default))}}}/></head><body><Providers${auth ? " initialUser={initialUser}" : ""}><AppShell>{children}</AppShell>${context.frontend.ai?.chat.enabled && context.frontend.ai.chat.placement === "floating" ? "<FloatingAssistant/>" : ""}</Providers></body></html>;`,
        "}",
        "",
      ].join("\n"),
    },
    ...["error", "global-error"].map((name) => ({
      path: `${root}/app/${name}.tsx`,
      content: `"use client";
export default function PageError({reset}:{reset:()=>void}){const content=<main role="alert" style={{padding:32}}><h1>We could not load this page</h1><p>The service may be temporarily unavailable. Your access has not been changed. Please try again.</p><button type="button" onClick={()=>${name === "global-error" ? "window.location.reload()" : "reset()"}}>Try again</button></main>;return ${name === "global-error" ? '<html lang="en"><body>{content}</body></html>' : "content"};}
`,
    })),
  ];
}
