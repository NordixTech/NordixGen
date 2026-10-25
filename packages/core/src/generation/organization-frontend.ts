import type { GeneratedFile } from "../plugins/contracts.js";
import type { FrontendRenderContext } from "../plugins/frontend-contracts.js";
import { organizationStyles } from "./organization-styles.js";
import { administration, invitation, switcher } from "./organization-views.js";

export function generateOrganizationFrontend(context: FrontendRenderContext): GeneratedFile[] {
  const policy = context.api.authentication?.organizations;
  if (!policy?.enabled) return [];
  const root = context.framework.codeRoot;
  return [
    {
      path: `${root}/styles/organization.css`,
      content: organizationStyles,
    },
    { path: `${root}/lib/auth/organization-context.ts`, content: organizationContext },
    { path: `${root}/components/organization/switcher.tsx`, content: switcher },
    {
      path: `${root}/components/organization/administration.tsx`,
      content: administration.replace(
        '"use client";',
        `"use client";\nconst multiple=${policy.mode === "multiple"};`,
      ),
    },
    { path: `${root}/components/organization/invitation.tsx`, content: invitation },
    ...(["roles", "members"] as const).map((section) => ({
      path: `${root}/app/organization/settings/${section}/page.tsx`,
      content: `import {requireOrganizationAccess} from "@/lib/auth/server";import {OrganizationAdministration} from "@/components/organization/administration";import "@/styles/iam.css";export const dynamic="force-dynamic";export default async function Organization${section}Page(){await requireOrganizationAccess(${JSON.stringify(section === "roles" ? "org:roles:manage" : "org:members:manage")});return <OrganizationAdministration section=${JSON.stringify(section)}/>;}\n`,
    })),
    {
      path: `${root}/app/organization/invitations/accept/page.tsx`,
      content:
        'import {OrganizationInvitation} from "@/components/organization/invitation";export const dynamic="force-dynamic";export default async function InvitationPage({searchParams}:{searchParams:Promise<{token?:string}>}){const {token}=await searchParams;return <OrganizationInvitation token={token??""}/>;}\n',
    },
  ];
}
const organizationContext = String.raw`let active:string|undefined,pending=false;
export function setTransportOrganization(id:string|undefined){active=id;}
export function organizationHeaders():Record<string,string>{return active?{'x-organization-id':active}:{};}
export function organizationSwitchPending(){return pending;}
export async function activateOrganization(organizationId:string):Promise<void>{
 pending=true;window.dispatchEvent(new Event('organization-changing'));
 try{const response=await fetch('/api/auth/iam/organizations/active',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',cache:'no-store',body:JSON.stringify({organizationId})});if(!response.ok){const error=await response.json().catch(()=>null);throw Error(error?.detail??'We could not switch organizations.');}active=undefined;window.location.assign(window.location.pathname+window.location.search);}
 catch(error){pending=false;window.dispatchEvent(new Event('organization-changing'));throw error;}
}
export function authReturnTarget():string{if(typeof window==='undefined')return '/';const value=new URLSearchParams(window.location.search).get('returnTo');if(!value)return '/';try{const url=new URL(value,window.location.origin);if(url.origin===window.location.origin&&url.pathname==='/organization/invitations/accept'&&/^[a-f0-9]{64}$/.test(url.searchParams.get('token')??''))return url.pathname+url.search;}catch{}return '/';}
`;
