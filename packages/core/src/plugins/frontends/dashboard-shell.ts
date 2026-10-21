import type { GeneratedFile } from "../contracts.js";
import type { FrontendRenderContext } from "../frontend-contracts.js";
import { brandFontCss, brandFontLicense, nordixLogo } from "./branding-assets.js";
import { dashboardStyles } from "./dashboard-styles.js";
import { dashboardOverviewSource } from "./dashboard.js";

export function dashboardShellFiles(context: FrontendRenderContext): GeneratedFile[] {
  const auth = Boolean(context.api.authentication);
  const reserved = new Set([
    "/",
    "/api-explorer",
    "/chat",
    "/connect-ai",
    "/profile",
    "/r2",
    "/admin/roles",
    "/audit",
    "/sign-in",
    "/sign-up",
    "/forgot-password",
    "/reset-password",
  ]);
  const links = [
    { href: "/", label: "Home", icon: "home", group: "Workspace" },
    ...(context.api.endpoints.length
      ? [{ href: "/api-explorer", label: "API Explorer", icon: "code", group: "Workspace" }]
      : []),
    ...context.frontend.pages
      .filter((page) => !reserved.has(page.path))
      .map((page) => ({
        href: page.path,
        label: page.path
          .slice(1)
          .split(/[/-]/)
          .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
          .join(" "),
        icon: "grid",
        group: "Application",
      })),
    ...(context.frontend.ai?.chat.enabled
      ? [
          {
            href: context.frontend.ai.chat.placement === "page" ? "/chat" : "#assistant",
            label: "AI Assistant",
            icon: "spark",
            group: "Intelligence",
          },
        ]
      : []),
    ...(context.frontend.ai?.connectPortal.enabled
      ? [{ href: "/connect-ai", label: "AI Connection", icon: "link", group: "Intelligence" }]
      : []),
    ...(context.frontend.storageBackends.length
      ? [{ href: "/r2", label: "Instancias R2", icon: "storage", group: "Workspace" }]
      : []),
    ...(auth
      ? [
          { href: "/admin/roles", label: "Administration", icon: "shield", group: "Manage" },
          { href: "/audit", label: "Auditoría", icon: "shield", group: "Manage" },
        ]
      : []),
  ];
  return [
    {
      path: `${context.framework.applicationRoot}/public/fonts/CaesarDressing-OFL.txt`,
      content: brandFontLicense,
    },
    {
      path: `${context.framework.codeRoot}/styles/dashboard.css`,
      content: `${brandFontCss}\n${dashboardStyles}`,
    },
    {
      path: `${context.framework.codeRoot}/components/layout/dashboard-overview.tsx`,
      content: dashboardOverviewSource(context),
    },
    {
      path: `${context.framework.codeRoot}/components/layout/brand.tsx`,
      content: `import Link from "next/link";
export function Brand(){return <Link className="ng-brand" href="/" aria-label="NordixGen home"><span className="ng-brand-art" aria-hidden="true" dangerouslySetInnerHTML={{__html:${JSON.stringify(nordixLogo)}}}/><span className="ng-wordmark">NORDIX</span><span className="ng-brand-gen">Gen</span></Link>;}
`,
    },
    {
      path: `${context.framework.codeRoot}/components/layout/app-shell.tsx`,
      content: `"use client";
import {useEffect,useRef,type ReactNode} from "react";
import Link from "next/link";
import {usePathname} from "next/navigation";
import {Brand} from "./brand";
${auth ? 'import {AuthControls} from "@/components/auth/auth-controls";\nimport {useSessionView} from "@/lib/auth/use-session-view";' : 'import {ThemeSwitcher} from "@/components/ui/theme-switcher";'}
const links=${JSON.stringify(links)};
const paths:Record<string,string>={storage:"M3 5h18v15H3zM3 10h18M7 15h3",home:"M3 10 12 3l9 7v10H3V10Zm6 10v-7h6v7",code:"m8 7-5 5 5 5m8-10 5 5-5 5m-3-13-2 20",grid:"M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z",spark:"m12 3 2.8 6.2L21 12l-6.2 2.8L12 21l-2.8-6.2L3 12l6.2-2.8L12 3Z",link:"m10 14 4-4m-6 6-1 1a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0m0 12a4 4 0 0 0 6 0l5-5a4 4 0 0 0-6-6l-1 1",shield:"m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Zm-4 9 3 3 5-6"};
function Icon({name}:{name:string}){return <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name]||paths.grid}/></svg>;}
export function AppShell({children}:{children:ReactNode}){
 const pathname=usePathname();const drawer=useRef<HTMLDialogElement>(null);const trigger=useRef<HTMLButtonElement>(null);
 ${auth ? 'const session=useSessionView();const canAudit=session.hasPermission("iam:roles:manage");const canAdmin=session.hasPermission("iam:roles:manage")||session.hasPermission("iam:users:manage-roles");' : "const canAdmin=false,canAudit=false;"}
 function close(){drawer.current?.close();}
 useEffect(()=>{close();},[pathname]);
 useEffect(()=>{const media=window.matchMedia("(min-width: 1024px)");const changed=()=>{if(media.matches)close();};media.addEventListener("change",changed);return()=>media.removeEventListener("change",changed);},[]);
 const navigation=(mobile=false)=><nav aria-label={mobile?"Mobile navigation":"Main navigation"}>{["Workspace","Application","Intelligence","Manage"].map(group=>{const items=links.filter(link=>link.group===group&&((link.href!=="/admin/roles"||canAdmin)&&(link.href!=="/audit"||canAudit)));return items.length?<section className="ng-nav-group" key={group}><p>{group}</p>{items.map(link=>link.href==="#assistant"?<button className="ng-nav-link" key={link.href} onClick={()=>{close();window.dispatchEvent(new Event("nordix-open-assistant"));}}><Icon name={link.icon}/><span>{link.label}</span></button>:<Link className="ng-nav-link" key={link.href} href={link.href} aria-current={(link.href==="/"?pathname==="/":pathname===link.href||pathname.startsWith(link.href+"/"))?"page":undefined} onClick={close}><Icon name={link.icon}/><span>{link.label}</span></Link>)}</section>:null;})}</nav>;
 return <div className="ng-app"><a className="ng-skip-link" href="#workspace-content">Skip to content</a><header className="ng-app-header"><div className="ng-header-start"><button className="ng-icon-button ng-mobile-toggle" type="button" aria-label="Open navigation" aria-haspopup="dialog" ref={trigger} onClick={()=>drawer.current?.showModal()}><svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8"><path d="M4 6h16M4 12h16M4 18h16"/></svg></button><Brand/></div><div className="ng-header-project">${context.projectName}</div>${auth ? "<AuthControls/>" : '<details className="ng-account-menu" onKeyDown={event=>{if(event.key==="Escape"){event.currentTarget.open=false;event.currentTarget.querySelector("summary")?.focus();}}}><summary aria-label="Appearance menu"><span className="ng-avatar" aria-hidden="true">◐</span><span className="ng-account-label"><strong>Appearance</strong><small>Your preferences</small></span></summary><div className="ng-account-popover"><div className="ng-menu-theme"><span>Appearance</span><ThemeSwitcher/></div></div></details>'}</header><aside className="ng-sidebar">{navigation()}<div className="ng-sidebar-footer"><span className="ng-status-dot"/>Generated with NordixGen</div></aside><dialog ref={drawer} className="ng-nav-drawer" aria-label="Navigation" onClick={event=>{if(event.target===event.currentTarget)close();}} onClose={()=>trigger.current?.focus()}><div className="ng-drawer-heading"><Brand/><button className="ng-icon-button" type="button" aria-label="Close navigation" onClick={close}>×</button></div>{navigation(true)}<p className="ng-sidebar-footer">Generated with NordixGen</p></dialog><div id="workspace-content" className="ng-app-content" tabIndex={-1}>{children}</div></div>;
}
`,
    },
  ];
}
