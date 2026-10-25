export function sessionViewSource(organizations: boolean): string {
  return `"use client";
import {authClient} from "@/lib/auth/client";
import {createContext,createElement,useContext,useEffect,useRef,useState,type ReactNode} from "react";
import {iamRequest} from "@/lib/iam/client";
import {canAccessOperation,hasPermission,hasRole,toSessionUser,type SessionUser,type OperationAccess} from "./permissions";
${organizations ? 'import {organizationSwitchPending,setTransportOrganization} from "./organization-context";' : "const organizationSwitchPending=()=>false;const setTransportOrganization=(_id:string|undefined)=>{};"}
type Access=SessionUser & {permissions:readonly string[]};
const InitialIdentity=createContext<SessionUser|null|undefined>(undefined);
export function InitialIdentityProvider({user,children}:{user?:SessionUser|null;children:ReactNode}){
 const session=authClient.useSession(),usable=useRef(true);
 if(!session.isPending||session.error)usable.current=false;
 return createElement(InitialIdentity.Provider,{value:usable.current?user:undefined},children);
}
let sharedAccess:Access|null=null,error:string|null=null,lastAccessAt=0,generation=0,activeKey:string|undefined;
let inFlight:{key:string;generation:number;promise:Promise<void>}|null=null;
const listeners=new Set<()=>void>();function publish(){for(const listener of listeners)listener();}
function clearIdentity(key:string|undefined){if(activeKey===key)return;activeKey=key;generation++;sharedAccess=null;error=null;lastAccessAt=0;inFlight=null;setTransportOrganization(undefined);}
async function refreshAccess(id:string,organizationId:string|undefined,key:string,force=false){
 if(!force&&sharedAccess?.id===id&&Date.now()-lastAccessAt<30000)return;
 if(inFlight?.key===key&&inFlight.generation===generation)return inFlight.promise;
 const ticket=generation;
 const promise=iamRequest<Access>("/me",{headers:organizationId?{"x-organization-id":organizationId}:{}}).then(value=>{
  if(ticket!==generation||activeKey!==key)return;
  if(value.id!==id)throw Error("Identity changed. Please try again.");
  sharedAccess=value;error=null;lastAccessAt=Date.now();setTransportOrganization(value.organizationId);publish();
 }).catch(()=>{if(ticket!==generation||activeKey!==key)return;sharedAccess=null;error="We could not verify your access. Please try again.";setTransportOrganization(undefined);publish();}).finally(()=>{if(inFlight?.generation===ticket&&inFlight.key===key)inFlight=null;});
 inFlight={key,generation:ticket,promise};return promise;
}
export function useSessionView():{user:SessionUser|null;isPending:boolean;error:string|null;retry:()=>void;hasPermission:(permission:string,scope?:"global"|"organization")=>boolean;hasRole:(role:string,scope?:"global"|"organization")=>boolean;canAccess:(policy:OperationAccess)=>boolean;}{
 const session=authClient.useSession(),initial=useContext(InitialIdentity),settled=useRef(false);
 if(!session.isPending)settled.current=true;
 const usingInitial=!settled.current&&session.isPending&&initial!==undefined&&!session.error;
 const user=usingInitial?initial:toSessionUser(session.data?.user);
 const organizationId=${organizations ? "usingInitial?initial?.organizationId:(session.data?.session as {activeOrganizationId?:string|null}|undefined)?.activeOrganizationId??undefined" : "undefined"};
 const id=user?.id,key=id?JSON.stringify([id,user?.role??null,organizationId??null]):undefined;
 const [,render]=useState(0);
 useEffect(()=>{const listener=()=>render(value=>value+1);listeners.add(listener);clearIdentity(key);
  if(id&&usingInitial&&initial?.id===id&&!sharedAccess){sharedAccess={...initial,permissions:[...(initial.permissions??[])]};lastAccessAt=Date.now();setTransportOrganization(initial.organizationId);}
  if(id&&key)void refreshAccess(id,organizationId,key);
  const focus=()=>{if(id&&key)void refreshAccess(id,organizationId,key);};
  const changed=()=>{void session.refetch();if(id&&key)void refreshAccess(id,organizationId,key,true);publish();};
  if(typeof window!=="undefined"){window.addEventListener("focus",focus);window.addEventListener("iam-changed",changed);window.addEventListener("organization-changing",listener);}
  return()=>{listeners.delete(listener);if(typeof window!=="undefined"){window.removeEventListener("focus",focus);window.removeEventListener("iam-changed",changed);window.removeEventListener("organization-changing",listener);}};
 },[id,key]);
 const access=sharedAccess?.id===id&&activeKey===key?sharedAccess:usingInitial&&user?{...user,permissions:[...(user.permissions??[])]}:null;
 const failure=session.error?"We could not verify your session. Please try again.":activeKey===key?error:null;
 const switching=organizationSwitchPending();
 const current=!failure&&user&&access?{...user,...access}:null;
 if(current&&!switching)setTransportOrganization(current.organizationId);
 const pending=!failure&&(switching||(session.isPending&&!usingInitial)||Boolean(user&&!access));
 const retry=()=>{void session.refetch();if(id&&key)void refreshAccess(id,organizationId,key,true);};
 return {user:current,isPending:pending,error:failure,retry,hasPermission:(permission,scope)=>!switching&&hasPermission(current,permission,scope),hasRole:(role,scope)=>!switching&&hasRole(current,role,scope),canAccess:policy=>!failure&&!switching&&canAccessOperation(current,pending,policy)};
}
`;
}
