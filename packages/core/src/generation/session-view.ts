export const sessionViewSource = String.raw`"use client";
import {authClient} from "@/lib/auth/client";
import {createContext,createElement,useContext,useEffect,useRef,useState,type ReactNode} from "react";
import {iamRequest} from "@/lib/iam/client";
import {canAccessOperation,hasPermission,hasRole,toSessionUser,type SessionUser,type OperationAccess} from "./permissions";
type Access={id:string;role:string;permissions:string[]};
const InitialIdentity=createContext<SessionUser|null|undefined>(undefined);
export function InitialIdentityProvider({user,children}:{user?:SessionUser|null;children:ReactNode}){
 const session=authClient.useSession(),usable=useRef(true);
 // Retire the server seed for the entire provider after the first live result, including new children.
 if(!session.isPending||session.error)usable.current=false;
 return createElement(InitialIdentity.Provider,{value:usable.current?user:undefined},children);
}
let sharedAccess:Access|null=null;
let accessError:string|null=null,lastAccessAt=0,generation=0,activeId:string|undefined,activeRole:string|null|undefined;
let inFlight:{id:string;generation:number;promise:Promise<void>}|null=null;
const listeners=new Set<()=>void>();
function publish(){for(const listener of listeners)listener();}
function clearIdentity(id:string|undefined,role:string|null|undefined){if(activeId===id&&activeRole===role)return;activeId=id;activeRole=role;generation++;sharedAccess=null;accessError=null;lastAccessAt=0;inFlight=null;}
async function refreshAccess(id:string,force=false){
 if(!force&&sharedAccess?.id===id&&Date.now()-lastAccessAt<30000)return;
 if(inFlight?.id===id&&inFlight.generation===generation)return inFlight.promise;
 const ticket=generation;
 const promise=iamRequest<Access>("/me").then(value=>{
  if(ticket!==generation||activeId!==id)return;
  if(value.id!==id)throw Error("Identity changed. Please try again.");
  sharedAccess=value;accessError=null;lastAccessAt=Date.now();publish();
 }).catch(()=>{
  if(ticket!==generation||activeId!==id)return;
  sharedAccess=null;accessError="We could not verify your access. Please try again.";publish();
 }).finally(()=>{if(inFlight?.generation===ticket&&inFlight.id===id)inFlight=null;});
 inFlight={id,generation:ticket,promise};return promise;
}
export function useSessionView():{
 user:SessionUser|null;isPending:boolean;error:string|null;retry:()=>void;
 hasPermission:(permission:string)=>boolean;hasRole:(role:string)=>boolean;canAccess:(policy:OperationAccess)=>boolean;
}{
 const session=authClient.useSession(),initial=useContext(InitialIdentity),settled=useRef(false);
 if(!session.isPending)settled.current=true;
 const usingInitial=!settled.current&&session.isPending&&initial!==undefined&&!session.error;
 const user=usingInitial?initial:toSessionUser(session.data?.user);
 const id=user?.id,role=user?.role;
 const [,render]=useState(0);
 useEffect(()=>{
  const listener=()=>render(value=>value+1);listeners.add(listener);
  clearIdentity(id,role);
  if(id&&usingInitial&&initial?.id===id&&!sharedAccess){sharedAccess={id,role:initial.role??"",permissions:[...(initial.permissions??[])]};lastAccessAt=Date.now();}
  if(id)void refreshAccess(id);
  const focus=()=>{if(id)void refreshAccess(id);};
  const changed=()=>{void session.refetch();if(id)void refreshAccess(id,true);};
  if(typeof window!=="undefined"){window.addEventListener("focus",focus);window.addEventListener("iam-changed",changed);}
  return()=>{listeners.delete(listener);if(typeof window!=="undefined"){window.removeEventListener("focus",focus);window.removeEventListener("iam-changed",changed);}};
 },[id,role]);
 const access=sharedAccess&&sharedAccess.id===id&&sharedAccess.role===(role??"")?sharedAccess:usingInitial&&user?{id:user.id,role:user.role??"",permissions:[...(user.permissions??[])]}:null;
 const error=session.error?"We could not verify your session. Please try again.":activeId===id?accessError:null;
 const current=!error&&user?{...user,role:access?.role??user.role,permissions:access?.permissions??[]}:null;
 const pending=!error&&((session.isPending&&!usingInitial)||Boolean(user&&!access));
 const retry=()=>{void session.refetch();if(id)void refreshAccess(id,true);};
 return {user:current,isPending:pending,error,retry,hasPermission:permission=>hasPermission(current,permission),hasRole:role=>hasRole(current,role),canAccess:policy=>!error&&canAccessOperation(current,pending,policy)};
}
`;
