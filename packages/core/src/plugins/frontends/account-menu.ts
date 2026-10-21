import type { GeneratedFile } from "../contracts.js";
import type { FrontendAuthenticationContract } from "../frontend-contracts.js";

export const accountMenuSource = `"use client";
import Link from "next/link";
import {useRef} from "react";
import {useSessionView} from "@/lib/auth/use-session-view";
import {SignOutButton} from "@/components/auth/sign-out-button";
import {ThemeSwitcher} from "@/components/ui/theme-switcher";
export function AuthControls(){
 const {user,isPending}=useSessionView();const menu=useRef<HTMLDetailsElement>(null);
 return <details className="ng-account-menu" ref={menu} onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node|null))event.currentTarget.open=false;}} onKeyDown={event=>{if(event.key==="Escape"&&menu.current){menu.current.open=false;menu.current.querySelector("summary")?.focus();}}}>
 <summary aria-label="Account menu"><span className="ng-avatar" aria-hidden="true">{user?.name?.trim().slice(0,1).toUpperCase()||"U"}</span><span className="ng-account-label"><strong>{isPending?"Checking session…":user?.name||user?.email||"Guest"}</strong><small>{user?.role|| (isPending?"Please wait":"Welcome")}</small></span><span aria-hidden="true">⌄</span></summary>
 <div className="ng-account-popover"><p className="ng-menu-heading">{user?.email||"Your workspace"}</p>{user?<><Link href="/profile" onClick={()=>{if(menu.current)menu.current.open=false;}}>My profile <span aria-hidden="true">↗</span></Link></>:!isPending?<Link href="/sign-in">Sign in <span aria-hidden="true">→</span></Link>:<p role="status">Checking login status…</p>}<div className="ng-menu-theme"><span>Appearance</span><ThemeSwitcher/></div>{user&&<SignOutButton/>}</div></details>;
}
`;

export function profileFiles(
  root: string,
  config: FrontendAuthenticationContract,
): GeneratedFile[] {
  const phone = config.methods.includes("phone-number");
  return [
    {
      path: `${root}/components/auth/profile-card.tsx`,
      content: `"use client";
import {authClient} from "@/lib/auth/client";
import {useSessionView} from "@/lib/auth/use-session-view";
${phone ? 'import {PhoneForm} from "./phone-form";' : ""}
export function ProfileCard(){const {data,isPending}=authClient.useSession();const {user:principal}=useSessionView();const user=data?.user;
if(isPending)return <p role="status">Loading your profile…</p>;
if(!user)return <p>Your session has ended. <a href="/sign-in">Sign in again</a>.</p>;
return <div className="ng-profile-grid"><section className="ng-panel ng-profile-summary"><span className="ng-profile-avatar" aria-hidden="true">{user.name?.trim().slice(0,1).toUpperCase()||"U"}</span><h2>{user.name||"Your account"}</h2><dl><div><dt>Name</dt><dd>{user.name||"Not provided"}</dd></div><div><dt>Email</dt><dd>{user.email?.endsWith("@phone.invalid")?"Phone account":user.email||"Not provided"}</dd></div><div><dt>Email verification</dt><dd>{user.emailVerified?"Verified":"Not verified"}</dd></div><div><dt>Role</dt><dd>{principal?.role||"Loading…"}</dd></div>${phone ? '<div><dt>Phone number</dt><dd>{user.phoneNumber||"No phone linked yet"}</dd></div>' : ""}</dl></section>${phone ? '<section className="ng-panel ng-profile-phone"><PhoneForm link/></section>' : '<section className="ng-panel"><p className="ng-eyebrow">Account access</p><h2>Your permissions</h2><p className="ng-panel-note">Access is managed by your workspace administrator.</p><ul className="ng-permission-list">{principal?.permissions?.map(permission=><li key={permission}>{permission=== "*"?"All workspace permissions":permission}</li>)}</ul>{!principal?.permissions?.length&&<p className="ng-panel-note">No permissions assigned.</p>}</section>'}</div>;}
`,
    },
    {
      path: `${root}/app/profile/page.tsx`,
      content: `import {ProfileCard} from "@/components/auth/profile-card";
export const metadata={title:"Your profile"};
export default function ProfilePage(){return <main className="ng-shell"><div className="ng-profile-page"><header className="ng-profile-header"><p className="ng-eyebrow">Account settings</p><h1>Your profile</h1><p>Review your personal details${phone ? " and manage your phone number" : " and workspace access"}.</p></header><ProfileCard/></div></main>;}
`,
    },
  ];
}
