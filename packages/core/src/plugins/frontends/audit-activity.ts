/** Presentation stays separate from access administration and stored audit facts. */
export const activityPresentation = `
export interface ActivityEntry {id:string;actorId:string;actorName?:string|null;actorEmail?:string|null;action:string;resourceType:string;resourceId:string|null;before:unknown;after:unknown;ipAddress:string|null;userAgent:string|null;metadata:unknown;createdAt:string;}
export const record=(value:unknown):Record<string,unknown>=>value!==null&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};
export function userLabel(entry:ActivityEntry){return entry.actorName?.trim()||entry.actorEmail|| (entry.actorId==="anonymous"?"Anonymous visitor":entry.actorId==="system"?"System":"Unknown or deleted user");}
const words=(value:string)=>value.replace(/([a-z])([A-Z])/g,"$1 $2").replace(/[._-]+/g," ");
export function actionLabel(action:string){const known:Record<string,string>={"auth.signin":"Signed in","auth.signin_failed":"Sign-in failed","auth.signout":"Signed out","auth.signup":"Created an account","auth.password_reset":"Reset password","iam.role.created":"Created a role","iam.role.updated":"Updated a role","iam.role.deleted":"Deleted a role","iam.user.role_assigned":"Changed a user's role"};if(known[action])return known[action];const parts=action.split(".");const verb=parts.pop()??action;const verbs:Record<string,string>={read:"Viewed",created:"Created",updated:"Updated",deleted:"Deleted"};return verbs[verb]?verbs[verb]+" "+words(parts.join(" ")):words(action);}
export function changes(before:unknown,after:unknown,path="$",result:{path:string;before:unknown;after:unknown}[]=[]){
 if(JSON.stringify(before)===JSON.stringify(after))return result;
 if(before&&after&&typeof before==="object"&&typeof after==="object"&&!Array.isArray(before)&&!Array.isArray(after)){
  const left=record(before),right=record(after);for(const key of new Set([...Object.keys(left),...Object.keys(right)]))changes(left[key],right[key],path+"."+key,result);
 }else result.push({path,before,after});return result;
}
export function detailFields(value:unknown,prefix="",depth=0):{label:string;value:string}[]{
 if(depth>3)return [{label:prefix,value:"Additional nested details"}];
 return Object.entries(record(value)).slice(0,50).flatMap(([key,item])=>{
  const label=(prefix?prefix+" · ":"")+words(key);if(item===null||item===undefined)return [];
  if(Array.isArray(item))return [{label,value:item.slice(0,20).map(part=>typeof part==="object"?"Record":String(part)).join(", ")||"None"}];
  if(typeof item==="object")return detailFields(item,label,depth+1);
  return [{label,value:String(item)}];
 });
}
export function requestDetails(entry:ActivityEntry){
 const meta=record(entry.metadata);const labels:Record<string,string>={method:"Method",path:"Route",status:"Response status",durationMs:"Duration",outcome:"Result",operationId:"Operation",transport:"Channel",params:"Route parameters",query:"Query parameters",resourceIds:"Affected records"};
 const fields=[...(entry.ipAddress?[{label:"IP address",value:entry.ipAddress}]:[]),...(entry.userAgent?[{label:"Browser / client",value:entry.userAgent}]:[])];
 for(const [key,value]of Object.entries(meta)){
  if(value===null||value===undefined)continue;
  if(key==="durationMs"&&typeof value==="number")fields.push({label:"Duration",value:value.toFixed(1)+" ms"});
  else if(typeof value==="object"&&!Array.isArray(value))fields.push(...detailFields(value,labels[key]??words(key)));
  else fields.push(...detailFields({[key]:value}).map(field=>({...field,label:labels[key]??field.label})));
 }return fields;
}
`;

export const auditActivity = `"use client";
import {useEffect,useState,type FormEvent} from "react";
import {iamRequest} from "@/lib/iam/client";
import {actionLabel,changes,requestDetails,userLabel,type ActivityEntry} from "@/lib/iam/activity-presentation";
interface Page {items:ActivityEntry[];total:number;page:number;pageSize:number;}
const pretty=(value:unknown)=>value===undefined?"Not recorded":JSON.stringify(value,null,2);
export function AuditActivity({revision}:{revision:number}){
 const [filters,setFilters]=useState({actor:"",action:"",from:"",to:""});
 const [query,setQuery]=useState(""),[page,setPage]=useState(1),[refresh,setRefresh]=useState(0);
 const [data,setData]=useState<Page>({items:[],total:0,page:1,pageSize:25}),[loading,setLoading]=useState(true),[error,setError]=useState("");
 useEffect(()=>{let active=true;setLoading(true);setError("");
  iamRequest<Page>("/audit?page="+page+"&pageSize=25"+query).then(value=>{if(active)setData(value);}).catch(reason=>{if(active){setData({items:[],total:0,page:1,pageSize:25});setError(reason instanceof Error?reason.message:"Activity is unavailable.");}}).finally(()=>{if(active)setLoading(false);});
  return()=>{active=false;};
 },[page,query,refresh,revision]);
 function applyFilters(next:typeof filters){const params=new URLSearchParams();for(const [key,value]of Object.entries(next))if(value.trim())params.set(key,key==="from"||key==="to"?new Date(value).toISOString():value.trim());setPage(1);setQuery(params.size?"&"+params.toString():"");setRefresh(value=>value+1);}
 function apply(event:FormEvent){event.preventDefault();applyFilters(filters);}
 return <section aria-label="Activity events" className="ng-audit" aria-busy={loading}>
  <header><p>Sign-ins, access changes and tracked application actions.</p><button type="button" className="ng-button ng-button--secondary" disabled={loading} onClick={()=>setRefresh(value=>value+1)}>Refresh activity</button></header>
  <form onSubmit={apply} className="ng-audit-filters">
   <label>User ID<input className="ng-input" placeholder="All users" value={filters.actor} maxLength={200} onChange={event=>setFilters({...filters,actor:event.target.value})}/></label>
   <label>Action<input className="ng-input" placeholder="All actions" value={filters.action} maxLength={200} onChange={event=>setFilters({...filters,action:event.target.value})}/></label>
   <label>From<input className="ng-input" type="datetime-local" value={filters.from} onChange={event=>setFilters({...filters,from:event.target.value})}/></label>
   <label>To<input className="ng-input" type="datetime-local" value={filters.to} onChange={event=>setFilters({...filters,to:event.target.value})}/></label>
   <button className="ng-button ng-button--primary" disabled={loading}>Apply filters</button>
  </form>
  {error&&<p role="alert" className="ng-iam-message ng-iam-message--error">{error}</p>}
  {loading?<p role="status">Loading activity…</p>:data.items.length?<ul className="ng-audit-events">{data.items.map(entry=><li key={entry.id}>
   <div className="ng-audit-event-heading"><div><strong>{actionLabel(entry.action)}</strong><code className="ng-activity-code">{entry.action}</code></div><time dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleString()}</time></div>
   <div className="ng-activity-person"><span className="ng-iam-avatar" aria-hidden="true">{userLabel(entry).slice(0,1).toUpperCase()}</span><div><strong>{userLabel(entry)}</strong>{entry.actorEmail&&entry.actorEmail!==userLabel(entry)&&<span>{entry.actorEmail}</span>}</div><button className="ng-text-link" type="button" disabled={loading} onClick={()=>{const next={...filters,actor:entry.actorId};setFilters(next);applyFilters(next);}}>Filter this user</button></div>
   <details><summary>View details</summary>
    <h3>Request details</h3>{requestDetails(entry).length?<dl className="ng-activity-details">{requestDetails(entry).map((field,index)=><div key={index}><dt>{field.label}</dt><dd>{field.value}</dd></div>)}</dl>:<p>No request details were recorded.</p>}
    <h3>Data changes</h3>{changes(entry.before,entry.after).length?<><p className="ng-activity-help">Before is the saved data before this action; After is the saved data afterwards. New records have no previous data, and deleted records have no remaining data.</p><div className="ng-audit-diffs">{changes(entry.before,entry.after).map(diff=><div key={diff.path}><code>{diff.path==="$"?"Record":diff.path.slice(2)}</code><div><section><h3>Before</h3><pre>{pretty(diff.before)}</pre></section><section><h3>After</h3><pre>{pretty(diff.after)}</pre></section></div></div>)}</div></>:<p>This event did not record data changes.</p>}
    <details className="ng-activity-identifiers"><summary>Technical identifiers</summary><dl className="ng-activity-details"><div><dt>User ID</dt><dd>{entry.actorId}</dd></div><div><dt>Resource type</dt><dd>{entry.resourceType}</dd></div>{entry.resourceId&&<div><dt>Record ID</dt><dd>{entry.resourceId}</dd></div>}<div><dt>Event ID</dt><dd>{entry.id}</dd></div></dl></details>
   </details>
  </li>)}</ul>:<p>No activity matches these filters.</p>}
  <footer><span>{data.total} events · Page {page}</span><div><button type="button" className="ng-button ng-button--secondary" disabled={loading||page===1} onClick={()=>setPage(value=>value-1)}>Previous activity</button><button type="button" className="ng-button ng-button--secondary" disabled={loading||page*25>=data.total} onClick={()=>setPage(value=>value+1)}>Next activity</button></div></footer>
 </section>;
}
`;
