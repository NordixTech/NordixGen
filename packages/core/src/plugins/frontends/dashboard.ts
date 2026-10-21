import type { FrontendRenderContext } from "../frontend-contracts.js";

/** Configuration counts, never database counts or invented live telemetry. */
export function dashboardPage(context: FrontendRenderContext): string {
  const stats = [
    {
      label: "API operations",
      value: context.api.endpoints.length,
      detail: "Available to this frontend",
    },
    {
      label: "Connected backends",
      value: context.frontend.connections.length,
      detail: "Application connections",
    },
    {
      label: "Configured roles",
      value: context.api.authentication?.roles.length ?? 0,
      detail: "Initial role catalog",
    },
    {
      label: "Known permissions",
      value: context.api.authentication?.permissions.length ?? 0,
      detail: "Declared access capabilities",
    },
  ];
  return `import {DashboardOverview} from "@/components/layout/dashboard-overview";
export default function Home(){return <main className="ng-shell ng-dashboard"><header className="ng-dashboard-heading"><p className="ng-eyebrow">Workspace overview</p><h1>Make yourself at home.</h1><p>Your application, connections and access — in one place.</p></header><section aria-label="Application configuration" className="ng-stat-grid">${stats.map((stat) => `<article className="ng-stat-card"><p>${stat.label}</p><strong>${stat.value}</strong><small>${stat.detail}</small></article>`).join("")}</section><DashboardOverview projectName={${JSON.stringify(context.projectName)}}/><p className="ng-dashboard-footnote">Application totals reflect generated configuration, not live database activity.</p></main>;}
`;
}

export function dashboardOverviewSource(context: FrontendRenderContext): string {
  const auth = Boolean(context.api.authentication);
  return `"use client";
import Link from "next/link";
${auth ? 'import {useSessionView} from "@/lib/auth/use-session-view";' : ""}
export function DashboardOverview({projectName}:{projectName:string}){
${auth ? "const {user,isPending}=useSessionView();" : ""}
return <div className="ng-dashboard-grid"><section className="ng-panel ng-workspace-card"><p className="ng-eyebrow">Built for your next step</p><h2>{projectName}</h2><p className="ng-panel-note">Explore your data, try an API operation or manage your workspace from the navigation.</p><div className="ng-dashboard-links">${context.api.endpoints.length ? '<Link className="ng-button ng-button--primary" href="/api-explorer">Explore the API <span aria-hidden="true">→</span></Link>' : ""}${context.frontend.ai?.chat.enabled && context.frontend.ai.chat.placement === "page" ? '<Link className="ng-button ng-button--secondary" href="/chat">AI Assistant</Link>' : ""}</div><div className="ng-workspace-meta"><span>Frontend</span><strong>${context.frontend.name}</strong><span>Connections</span><strong>${context.frontend.connections.join(", ") || "Standalone"}</strong></div></section><section className="ng-panel"><p className="ng-eyebrow">Your account</p><h2>${auth ? '{isPending?"Checking your access…":user?"Welcome, "+(user.name||"there"):"You are browsing as a guest"}' : "Public workspace"}</h2>${auth ? '<p className="ng-panel-note">{user?"Your current role: "+(user.role||"No role assigned"):"Sign in to see your profile and assigned permissions."}</p><ul className="ng-permission-list">{user?.permissions?.map(permission=><li key={permission}>{permission==="*"?"All workspace permissions":permission}</li>)}</ul>{user&&!user.permissions?.length&&<p className="ng-panel-note">No permissions assigned.</p>}<Link className="ng-text-link" href={user?"/profile":"/sign-in"}>{user?"View my profile":"Sign in"} →</Link>' : '<p className="ng-panel-note">This frontend does not require an account. Use the navigation to explore the available pages.</p>'}</section></div>;
}
`;
}
