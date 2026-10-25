import type { GeneratedFile } from "../contracts.js";
import type { FrontendRenderContext } from "../frontend-contracts.js";
import { activityPresentation, auditActivity } from "./audit-activity.js";
import { iamStyles } from "./iam-styles.js";

export function generateFrontendIam(context: FrontendRenderContext): readonly GeneratedFile[] {
  if (!context.api.authentication) return [];
  const root = context.framework.codeRoot;
  const files: GeneratedFile[] = [
    { path: `${root}/components/iam/audit-activity.tsx`, content: auditActivity },
    { path: `${root}/lib/iam/activity-presentation.ts`, content: activityPresentation },
    {
      path: `${root}/app/audit/page.tsx`,
      content: `import {requireIamAccess} from "@/lib/auth/server";
import {AuditLog} from "@/components/iam/audit-log";
import "@/styles/iam.css";
export default async function AuditPage(){
 await requireIamAccess("iam:roles:manage");
 return <main className="ng-iam-page"><header className="ng-iam-heading"><div><p className="ng-iam-eyebrow">SECURITY & ACCOUNTABILITY</p><h1>Activity</h1><p>Review who did what and when across your application.</p></div></header><AuditLog/></main>;
}
`,
    },
    {
      path: `${root}/components/iam/audit-log.tsx`,
      content: `"use client";
import {useSessionView} from "@/lib/auth/use-session-view";
import {AuditActivity} from "./audit-activity";
export function AuditLog(){
 const session=useSessionView();
 if(session.isPending)return <p role="status">Checking your access…</p>;
 if(!session.hasPermission("iam:roles:manage"))return <p role="alert">Your account cannot view audit history.</p>;
 return <div className="ng-iam-card"><AuditActivity key={session.user?.id} revision={0}/></div>;
}
`,
    },
    {
      path: `${root}/styles/iam.css`,
      content: iamStyles,
    },
    {
      path: `${root}/lib/iam/client.ts`,
      content: `export interface IamRole {id:string;name:string;description:string|null;isSystem:boolean;permissions:string[];}
export interface IamUser {id:string;name:string;email:string;role:string;roles?:string[];}
export interface AccessImpact {code:string;token:string;selfLoss:string[];lost:string[];affected:number;}
export class IamError extends Error {constructor(message:string,public impact?:AccessImpact){super(message);}}
${context.api.authentication.organizations.enabled ? 'import {organizationHeaders} from "@/lib/auth/organization-context";' : ""}
export async function iamRequest<T>(path:string,init:RequestInit={}):Promise<T>{
 const headers=new Headers(${context.api.authentication.organizations.enabled ? "organizationHeaders()" : "undefined"});new Headers(init.headers).forEach((value,name)=>headers.set(name,value));if(init.body!=null)headers.set("Content-Type","application/json");
 const response=await fetch("/api/auth/iam"+path,{...init,headers,credentials:"include",cache:"no-store"});
 if(!response.ok){const error=await response.json().catch(()=>null);throw new IamError(error?.detail??error?.message??"Administration request failed.",error?.code?error:undefined);}
 return response.status===204?undefined as T:await response.json() as T;
}
`,
    },
    {
      path: `${root}/app/admin/roles/page.tsx`,
      content: `import {requireIamAccess} from "@/lib/auth/server";
import Link from "next/link";
import {IamAdministration} from "@/components/iam/administration";
import "@/styles/iam.css";
export default async function RolesPage(){
 await requireIamAccess();
 return <main className="ng-iam-page">
  <nav className="ng-iam-breadcrumb" aria-label="Breadcrumb"><Link href="/">Workspace</Link><span aria-hidden="true">/</span><span>Administration</span></nav>
  <header className="ng-iam-heading"><div><p className="ng-iam-eyebrow">SECURITY & ACCESS</p><h1>Access administration</h1><p>Give your team the right access. Manage roles, permissions, and the people who use them.</p></div><span className="ng-iam-live"><span/> Changes apply immediately</span></header>
  <IamAdministration />
 </main>;
}
`,
    },
    {
      path: `${root}/components/iam/administration.tsx`,
      content: `"use client";
import {useEffect,useState,type FormEvent} from "react";
import {useSessionView} from "@/lib/auth/use-session-view";
import {iamRequest,IamError,type AccessImpact,type IamRole,type IamUser} from "@/lib/iam/client";
import {Dialog} from "@/components/ui/dialog";
import {Table} from "@/components/ui/table";
type Draft={id:string;name:string;description:string;permissions:string[];existing:boolean};
type Tab="roles"|"users";
const defaultRole=${JSON.stringify(context.api.authentication.defaultRole)};
const iconPaths={
 roles:"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M16 3a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-3.87M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
 key:"M15 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0M11 11v10M11 17h4M11 21h3",
 users:"M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
 search:"M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
 plus:"M12 5v14M5 12h14",
 edit:"M12 20H4v-8M16 4l4 4M10 18l-4 1 1-4L17 5a2.12 2.12 0 0 1 3 3Z",
 trash:"M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7",
 lock:"M6 11h12v10H6ZM8 11V7a4 4 0 0 1 8 0v4",
 shield:"M12 3l8 3v6c0 5-8 9-8 9s-8-4-8-9V6ZM8 12l3 3 5-6",
 check:"M5 12l4 4L19 6"
} as const;
function Icon({name}:{name:keyof typeof iconPaths}){return <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round"><path d={iconPaths[name]}/></svg>;}
function title(value:string){return value==="iam"?"Administration":value.replaceAll("-"," ").split(" ").map(word=>word.charAt(0).toUpperCase()+word.slice(1)).join(" ");}
function permissionLabel(value:string){
 if(value==="iam:roles:manage")return "Manage roles & permissions";
 if(value==="iam:users:manage-roles")return "Assign user roles";
 if(value.startsWith("storage:")){const [,key,action]=value.split(":");return (action==="read"?"Browse & download ":"Upload to ")+key;}
 const [subject,...actions]=value.split(":");
 const action=actions.join(" ");
 return (action==="read"?"View ":action==="write"?"Create & update ":title(action)+" ")+subject.replaceAll("-"," ");
}
function permissionDescription(value:string){
 if(value==="iam:roles:manage")return "Create roles and decide what each role can do.";
 if(value==="iam:users:manage-roles")return "View users and assign them an existing role.";
 if(value.startsWith("storage:"))return value.endsWith(":read")?"List files, preview documents, and download through the backend or a signed URL.":"Upload new files to this storage instance. Existing file keys cannot be replaced.";
 return value.endsWith(":read")?"Browse and read these records.":value.endsWith(":write")?"Create records and make changes.":"Allow this application capability.";
}
export function IamAdministration(){
 const session=useSessionView();
 const manageRoles=session.hasPermission("iam:roles:manage"),manageUsers=session.hasPermission("iam:users:manage-roles");
 const userId=session.user?.id;
 const [confirmation,setConfirmation]=useState<{path:string;method:string;message:string;value:unknown;impact:AccessImpact}|null>(null);
 const [roles,setRoles]=useState<IamRole[]>([]),[options,setOptions]=useState<{id:string;name:string}[]>([]),[permissions,setPermissions]=useState<string[]>([]);
 const [users,setUsers]=useState<IamUser[]>([]),[total,setTotal]=useState(0),[page,setPage]=useState(1);
 const [draft,setDraft]=useState<Draft|null>(null),[deleting,setDeleting]=useState<IamRole|null>(null);
 const [error,setError]=useState(""),[success,setSuccess]=useState(""),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[revision,setRevision]=useState(0);
 const [tab,setTab]=useState<Tab>("roles"),[search,setSearch]=useState("");
 const activeTab=manageRoles&&(!manageUsers||tab==="roles")?"roles":"users";
 useEffect(()=>{let active=true;setError("");setLoading(true);
  const load=async()=>{
   if(manageRoles&&activeTab==="roles"){const [catalog,registry]=await Promise.all([iamRequest<IamRole[]>("/roles"),iamRequest<string[]>("/permissions")]);if(active){setRoles(catalog);setPermissions(registry);}}
   if(manageUsers&&activeTab==="users"){const [catalog,result]=await Promise.all([iamRequest<{id:string;name:string}[]>("/role-options"),iamRequest<{items:IamUser[];total:number}>("/users?page="+page+"&pageSize=25")]);if(active){setOptions(catalog);setUsers(result.items);setTotal(result.total);}}
  };void load().catch(reason=>{if(active)setError(reason instanceof Error?reason.message:"Could not load administration.");}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};
 },[manageRoles,manageUsers,activeTab,page,revision,userId]);
 async function mutate(path:string,method:string,message:string,value?:unknown){setBusy(true);setError("");setSuccess("");try{
  await iamRequest(path,{method,...(value===undefined?{}:{body:JSON.stringify(value)})});setConfirmation(null);setDraft(null);setDeleting(null);setSuccess(message);setRevision(value=>value+1);window.dispatchEvent(new Event("iam-changed"));
  const current=await iamRequest<{permissions:string[]}>("/me");if(!current.permissions.some(permission=>["*","iam:roles:manage","iam:users:manage-roles"].includes(permission)))window.location.assign("/");
 }catch(reason){if(reason instanceof IamError&&reason.impact?.code==="confirmation_required"){setConfirmation({path,method,message,value,impact:reason.impact});}else{setConfirmation(null);setError(reason instanceof Error?reason.message:"Administration request failed.");}}finally{setBusy(false);}}

 function save(event:FormEvent){event.preventDefault();if(!draft)return;void mutate("/roles"+(draft.existing?"/"+encodeURIComponent(draft.id):""),draft.existing?"PUT":"POST",draft.existing?"Role updated. The new permissions are now in effect.":"Role created. You can now assign it to your team.",{...(!draft.existing?{id:draft.id}:{}),name:draft.name,description:draft.description||null,permissions:draft.permissions});}
 function changeTab(value:Tab){setTab(value);setSearch("");setSuccess("");}
 if(session.isPending)return <div className="ng-iam-empty" role="status"><Icon name="shield"/><p>Checking your access…</p></div>;
 if(!manageRoles&&!manageUsers)return <div className="ng-iam-message ng-iam-message--error" role="alert">You do not have access to administration.</div>;
 const groups=[...new Set(permissions.map(permission=>permission.split(":")[0]))];
 const query=search.toLowerCase().trim();
 const visibleRoles=roles.filter(role=>[role.name,role.id,role.description??"",...role.permissions].join(" ").toLowerCase().includes(query));
 const visibleUsers=users.filter(user=>[user.name,user.email,user.role].join(" ").toLowerCase().includes(query));
 const allGranted=draft?.permissions.includes("*")??false;
 const selected=allGranted?permissions.length:draft?.permissions.length??0;
 return <div className="ng-iam-workspace">
  <div className="ng-iam-summary" aria-label="Access overview">
   {manageRoles&&<><div className="ng-iam-stat"><span className="ng-iam-stat-icon"><Icon name="roles"/></span><div><span>Roles</span><strong>{loading&&roles.length===0?"—":roles.length}</strong></div><p>Access profiles for your team</p></div><div className="ng-iam-stat"><span className="ng-iam-stat-icon"><Icon name="key"/></span><div><span>Permissions</span><strong>{loading&&permissions.length===0?"—":permissions.length}</strong></div><p>Available application capabilities</p></div></>}
   {manageUsers&&<div className="ng-iam-stat"><span className="ng-iam-stat-icon"><Icon name="users"/></span><div><span>Team members</span><strong>{loading&&users.length===0?"—":total}</strong></div><p>People with an assigned role</p></div>}
  </div>
  {error&&!draft&&!deleting&&<div className="ng-iam-message ng-iam-message--error" role="alert"><span>{error}</span><button type="button" onClick={()=>setRevision(value=>value+1)}>Try again</button></div>}
  {success&&<div className="ng-iam-message ng-iam-message--success" role="status"><Icon name="check"/><span>{success}</span></div>}
  <section className="ng-iam-card" aria-busy={loading}>
   <div className="ng-iam-card-top"><div role="tablist" aria-label="Access management" className="ng-iam-tabs" onKeyDown={event=>{if(["ArrowLeft","ArrowRight","Home","End"].includes(event.key)){event.preventDefault();const tabs:Tab[]=[...(manageRoles?["roles" as const]:[]),...(manageUsers?["users" as const]:[])];const next=tabs[event.key==="Home"?0:event.key==="End"?tabs.length-1:(tabs.indexOf(activeTab)+(event.key==="ArrowRight"?1:tabs.length-1))%tabs.length];changeTab(next);document.getElementById("iam-"+next+"-tab")?.focus();}}}>
    {manageRoles&&<button id="iam-roles-tab" role="tab" tabIndex={activeTab==="roles"?0:-1} aria-selected={activeTab==="roles"} aria-controls="iam-roles-panel" onClick={()=>changeTab("roles")}><Icon name="roles"/>Roles<span>{roles.length}</span></button>}
    {manageUsers&&<button id="iam-users-tab" role="tab" tabIndex={activeTab==="users"?0:-1} aria-selected={activeTab==="users"} aria-controls="iam-users-panel" onClick={()=>changeTab("users")}><Icon name="users"/>Users<span>{total}</span></button>}
   </div><span className="ng-iam-card-hint"><Icon name="lock"/>Permission-based access</span></div>
   <div className="ng-iam-toolbar"><div><h2 id={activeTab==="roles"?"roles-title":"users-title"}>{activeTab==="roles"?"Roles":"Users"}</h2><p>{activeTab==="roles"?"Define what each role can do across your application.":"Assign an existing role to give each person the access they need."}</p></div><div className="ng-iam-toolbar-actions"><label className="ng-iam-search"><Icon name="search"/><input type="search" aria-label={activeTab==="roles"?"Search roles":"Search users on this page"} placeholder={activeTab==="roles"?"Search roles…":"Search this page…"} value={search} onChange={event=>setSearch(event.target.value)}/></label>{manageRoles&&activeTab==="roles"&&<button className="ng-button ng-button--primary" disabled={busy||loading} onClick={()=>{setError("");setDraft({id:"",name:"",description:"",permissions:[],existing:false});}}><Icon name="plus"/>Create role</button>}</div></div>
   {activeTab==="roles"&&manageRoles&&<div role="tabpanel" id="iam-roles-panel" aria-labelledby="iam-roles-tab">
    {loading&&roles.length===0?<div className="ng-iam-empty" role="status">Loading roles…</div>:<><Table className="ng-iam-roles-table"><thead><tr><th scope="col">Role</th><th scope="col">Permissions</th><th scope="col"><span className="ng-iam-actions-label">Actions</span></th></tr></thead><tbody>{visibleRoles.map(role=><tr key={role.id}><td><div className="ng-iam-role-cell"><span className={"ng-iam-role-icon"+(role.isSystem?" ng-iam-role-icon--system":"")}><Icon name={role.isSystem?"shield":"roles"}/></span><div><div className="ng-iam-role-name">{role.name}{role.isSystem&&<span className="ng-iam-tag ng-iam-tag--system"><Icon name="lock"/>System</span>}</div><span className="ng-iam-role-id">{role.id}</span>{role.description&&<p>{role.description}</p>}</div></div></td><td><div className="ng-iam-grants">{role.permissions.includes("*")?<span className="ng-iam-tag ng-iam-tag--full"><Icon name="shield"/>Full access</span>:role.permissions.length?role.permissions.map(permission=><span className={"ng-iam-tag"+(permission.startsWith("iam:")?" ng-iam-tag--admin":"")} key={permission} title={permission}>{permissionLabel(permission)}</span>):<span className="ng-iam-muted">No permissions assigned</span>}</div></td><td><div className="ng-iam-row-actions"><button className="ng-iam-edit" aria-label={"Edit "+role.id} disabled={busy} onClick={()=>{setError("");setDraft({id:role.id,name:role.name,description:role.description??"",permissions:role.permissions,existing:true});}}><Icon name="edit"/>Edit</button><button className="ng-iam-icon-button ng-iam-icon-button--danger" aria-label={"Delete "+role.id} title={role.isSystem?"System roles cannot be deleted":"Delete role"} disabled={busy||role.isSystem} onClick={()=>{setError("");setDeleting(role);}}><Icon name={role.isSystem?"lock":"trash"}/></button></div></td></tr>)}</tbody></Table>{visibleRoles.length===0&&<div className="ng-iam-empty"><Icon name="search"/><h3>No roles found</h3><p>Try a different name or permission.</p></div>}</>}
    <footer className="ng-iam-card-footer"><span>{visibleRoles.length} of {roles.length} roles</span><span><Icon name="shield"/>System roles are protected from deletion.</span></footer>
   </div>}
   {activeTab==="users"&&manageUsers&&<div role="tabpanel" id="iam-users-panel" aria-labelledby="iam-users-tab">
    {loading&&users.length===0?<div className="ng-iam-empty" role="status">Loading users…</div>:<><Table className="ng-iam-users-table"><thead><tr><th scope="col">Team member</th><th scope="col">Assigned role</th></tr></thead><tbody>{visibleUsers.map(user=><tr key={user.id}><td><div className="ng-iam-person"><span className="ng-iam-avatar" aria-hidden="true">{(user.name||user.email).split(" ").filter(Boolean).slice(0,2).map(word=>word[0]).join("").toUpperCase()}</span><div><div className="ng-iam-role-name">{user.name||"Unnamed user"}{user.id===userId&&<span className="ng-iam-tag">You</span>}</div><span className="ng-iam-email">{user.email}</span></div></div></td><td><div className="ng-iam-role-picker"><select className="ng-input" aria-label={"Role for "+user.email} disabled={busy||loading} value={user.role} onChange={event=>void mutate("/users/"+encodeURIComponent(user.id)+"/role","POST","User role updated. Their new access applies on the next request.",{role:event.target.value})}>{options.map(role=><option key={role.id} value={role.id}>{role.name}</option>)}</select></div></td></tr>)}</tbody></Table>{visibleUsers.length===0&&<div className="ng-iam-empty"><Icon name="users"/><h3>No users found</h3><p>{query?"Try another name, email, or role on this page.":"New accounts will appear here after registration."}</p></div>}</>}
    <footer className="ng-iam-card-footer"><span>{total===0?"No users":String((page-1)*25+1)+"–"+Math.min(page*25,total)+" of "+total+" users"}</span>{query&&<span>Filtered on this page</span>}<div className="ng-iam-pagination"><button className="ng-button ng-button--secondary" disabled={busy||loading||page===1} onClick={()=>setPage(page-1)}>Previous</button><span>Page {page}</span><button className="ng-button ng-button--secondary" disabled={busy||loading||page*25>=total} onClick={()=>setPage(page+1)}>Next</button></div></footer>
   </div>}
  </section>
  {confirmation&&<Dialog open title={confirmation.impact.selfLoss.length?"Remove your own administrative access?":"Remove administrative access?"} description="Changes take effect immediately." onOpenChange={open=>{if(!open&&!busy)setConfirmation(null);}}><div className="ng-iam-editor"><div className="ng-iam-editor-note"><Icon name="shield"/><div><strong>{confirmation.impact.selfLoss.length?"This change affects your own account.":"This change affects "+confirmation.impact.affected+" team member(s)."}</strong><p>{confirmation.impact.selfLoss.length?"You will lose the capabilities listed below. You may need another administrator to restore your access.":"These users will lose the administrative capabilities listed below."}</p></div></div><ul>{(confirmation.impact.selfLoss.length?confirmation.impact.selfLoss:confirmation.impact.lost).map(permission=><li key={permission}>{permissionLabel(permission)}</li>)}</ul><p>You can cancel to keep the current access.</p><footer className="ng-iam-editor-footer"><button data-initial-focus type="button" className="ng-button ng-button--secondary" disabled={busy} onClick={()=>setConfirmation(null)}>Cancel</button><button type="button" className="ng-button ng-iam-delete-confirm" disabled={busy} onClick={()=>void mutate(confirmation.path,confirmation.method,confirmation.message,{...confirmation.value as object,confirmation:confirmation.impact.token})}>{busy?"Applying…":"Confirm access change"}</button></footer></div></Dialog>}
  <p className="ng-iam-footnote"><Icon name="shield"/>Access is verified by your application on every request.</p>
  {manageRoles&&draft&&!confirmation&&<Dialog open title={draft.existing?"Edit role":"Create role"} description={draft.existing?"Changes apply to everyone assigned to this role.":"Create an access profile, then assign it to your team."} onOpenChange={open=>{if(!open&&!busy)setDraft(null);}}><form onSubmit={save} className="ng-iam-editor">
   <section className="ng-iam-details" aria-labelledby="iam-details-title"><h3 id="iam-details-title">Role details</h3><div className="ng-iam-field-grid"><div className="ng-field"><label htmlFor="iam-role-name">Name</label><input id="iam-role-name" className="ng-input" required maxLength={200} disabled={busy} placeholder="e.g. Billing manager" value={draft.name} onChange={event=>setDraft({...draft,name:event.target.value})}/></div><div className="ng-field"><label htmlFor="iam-role-id">ID</label><input id="iam-role-id" className="ng-input ng-iam-code" required pattern="[a-z][a-z0-9-]*" maxLength={100} disabled={draft.existing||busy} placeholder="billing-manager" aria-describedby="iam-id-help" value={draft.id} onChange={event=>setDraft({...draft,id:event.target.value})}/><small id="iam-id-help">{draft.existing?"The role ID cannot be changed.":"Lowercase letters, numbers, and hyphens."}</small></div></div><div className="ng-field"><label htmlFor="iam-role-description">Description <span className="ng-iam-optional">Optional</span></label><textarea id="iam-role-description" className="ng-input" rows={2} maxLength={2000} disabled={busy} placeholder="What is this role used for?" value={draft.description} onChange={event=>setDraft({...draft,description:event.target.value})}/></div></section>
   <section aria-labelledby="iam-permissions-title"><div className="ng-iam-permissions-heading"><div><h3 id="iam-permissions-title">Permissions</h3><p>Choose what people with this role can do.</p></div><span className="ng-iam-tag">{selected} of {permissions.length} selected</span></div>
    {allGranted&&<div className="ng-iam-editor-note"><Icon name="shield"/><div><strong>Full administrator access</strong><p>This system role includes every permission. Its management access is protected.</p></div></div>}
    {draft.id===defaultRole&&<div className="ng-iam-editor-note"><Icon name="lock"/><div><strong>Default signup role</strong><p>New accounts receive this role. Administration permissions cannot be granted to it.</p></div></div>}
    <div className="ng-iam-permission-groups">{groups.map(group=><fieldset className="ng-iam-permission-group" key={group}><legend><Icon name={group==="iam"?"shield":"key"}/>{title(group)}</legend>{permissions.filter(permission=>permission.split(":")[0]===group).map(permission=>{const checked=allGranted||draft.permissions.includes(permission);return <label className={"ng-iam-permission"+(checked?" ng-iam-permission--selected":"")} key={permission}><input type="checkbox" disabled={busy||allGranted||(draft.id===defaultRole&&group==="iam")} checked={checked} onChange={event=>setDraft({...draft,permissions:event.target.checked?[...draft.permissions,permission]:draft.permissions.filter(value=>value!==permission)})}/><span><strong>{permissionLabel(permission)}</strong><span>{permissionDescription(permission)}</span><code>{permission}</code></span></label>;})}</fieldset>)}</div>
   </section>
   {error&&<div className="ng-iam-message ng-iam-message--error" role="alert">{error}</div>}
   <footer className="ng-iam-editor-footer"><button className="ng-button ng-button--secondary" type="button" disabled={busy} onClick={()=>setDraft(null)}>Cancel</button><button className="ng-button ng-button--primary" type="submit" disabled={busy}>{busy?"Saving…":"Save role"}</button></footer>
  </form></Dialog>}
  {manageRoles&&deleting&&<Dialog open title="Delete role?" description="This action cannot be undone." onOpenChange={open=>{if(!open&&!busy)setDeleting(null);}}><div className="ng-iam-editor"><p>Delete <strong>{deleting.name}</strong>? A role can only be deleted when no users are assigned to it.</p>{error&&<div className="ng-iam-message ng-iam-message--error" role="alert">{error}</div>}<footer className="ng-iam-editor-footer"><button type="button" className="ng-button ng-button--secondary" disabled={busy} onClick={()=>setDeleting(null)}>Cancel</button><button type="button" className="ng-button ng-iam-delete-confirm" disabled={busy} onClick={()=>void mutate("/roles/"+encodeURIComponent(deleting.id),"DELETE","Role deleted.")}>{busy?"Deleting…":"Delete role"}</button></footer></div></Dialog>}
 </div>;
}
`,
    },
  ];
  if (!context.api.authentication.global.enabled)
    return files.filter(
      (file) => file.path === `${root}/lib/iam/client.ts` || file.path === `${root}/styles/iam.css`,
    );
  if (context.api.authentication.global.mode === "multiple")
    return files.map((file) => ({
      ...file,
      content: file.content
        .replace(
          "value={user.role} onChange={event=>void mutate",
          "multiple value={user.roles??[]} onChange={event=>void mutate",
        )
        .replace(
          "{role:event.target.value}",
          "{roles:Array.from(event.currentTarget.selectedOptions,option=>option.value)}",
        ),
    }));
  return files;
}
