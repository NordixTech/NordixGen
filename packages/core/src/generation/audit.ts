import type { BackendRenderContext, GeneratedFile } from "../plugins/contracts.js";
export function generateAuditFiles(context: BackendRenderContext): readonly GeneratedFile[] {
  const root = context.platformRoot;
  return [
    { path: `${root}/database/schema/audit-schema.ts`, content: auditSchema },
    { path: `${root}/audit/runtime.ts`, content: auditRuntime },
    { path: `${root}/audit/store.ts`, content: auditStore },
  ];
}
export const authAuditPlugin = `import type {BetterAuthPlugin} from "better-auth";
import {createAuthMiddleware,getSessionFromCtx} from "better-auth/api";
import {authAuditAction,type AuditService} from "../audit/runtime.js";
/** Last in plugin order: a pending two-factor challenge is not a completed sign-in. */
export function nordixAuditPlugin(audit:AuditService) {
 return {
  id:"nordix-audit",
  hooks:{
   before:[{matcher:ctx=>ctx.path==="/sign-out",handler:createAuthMiddleware(async ctx=>{
    try{const session=await getSessionFromCtx(ctx);(ctx.context as {auditActorId?:string}).auditActorId=session?.user.id;}catch{}
   })}],
   after:[{matcher:ctx=>typeof ctx.path==="string"&&!ctx.path.startsWith("/iam/"),handler:createAuthMiddleware(async ctx=>{
    try{
     const returned=ctx.context.returned;
     const action=authAuditAction(ctx.path,Boolean(ctx.context.newSession),returned);
     if(!action)return;
     const failed=returned&&typeof returned==="object"&&"statusCode" in returned&&Number(returned.statusCode)>=400;
     const user=returned&&typeof returned==="object"&&"user" in returned?returned.user as {id?:string}|undefined:undefined;
     const actorId=ctx.context.newSession?.user.id??ctx.context.session?.user.id??user?.id??(ctx.context as {auditActorId?:string}).auditActorId??"anonymous";
     audit.record({actorId,action:failed&&action!=="auth.signin_failed"?action+"_failed":action,resourceType:"auth",resourceId:actorId==="anonymous"?null:actorId,metadata:{outcome:failed?"failure":"success",status:failed?Number((returned as {statusCode:number}).statusCode):returned instanceof Response?returned.status:returned&&typeof returned==="object"&&"statusCode" in returned?Number(returned.statusCode):200}},ctx.headers??undefined);
     if(action.startsWith("auth.two_factor.")&&ctx.context.newSession&&!failed)audit.record({actorId,action:"auth.signin",resourceType:"auth",resourceId:actorId,metadata:{method:"two-factor",outcome:"success"}},ctx.headers??undefined);
    }catch{console.error("Audit capture failed.");}
   })}],
  },
 } satisfies BetterAuthPlugin;
}
`;
const auditRuntime = `/** Audit capture is bounded, detached from the primary operation, and never throws into it. */
export interface AuditEvent {actorId?:string;action:string;resourceType:string;resourceId?:string|null;before?:unknown;after?:unknown;metadata?:unknown;}
export interface AuditRecord {id:string;actorId:string;action:string;resourceType:string;resourceId:string|null;before:unknown;after:unknown;ipAddress:string|null;userAgent:string|null;metadata:unknown;createdAt:Date;}
export interface AuditExecutionContext {waitUntil(task:Promise<unknown>):void;}
export interface AuditService {record(event:AuditEvent,headers?:Headers):void;}
export type AuditWriter=(record:AuditRecord)=>Promise<unknown>;
const secret=/(password|passwd|secret|token|cookie|authorization|credential|otp|backupcode|recoverycode|verificationcode)/i;
export function safeAuditValue(value:unknown,depth=0):unknown {
 if(value===undefined||value===null)return null;
 if(depth>8)return "[depth limit]";
 if(value instanceof Date)return value.toISOString();
 if(typeof value==="string")return value.length>4096?value.slice(0,4096)+"[truncated]":value;
 if(typeof value==="number")return Number.isFinite(value)?value:null;
 if(typeof value==="boolean")return value;
 if(Array.isArray(value))return value.slice(0,100).map(item=>safeAuditValue(item,depth+1));
 if(typeof value==="object")return Object.fromEntries(Object.entries(value).slice(0,100).map(([key,item])=>[key,secret.test(key)?"[redacted]":safeAuditValue(item,depth+1)]));
 return null;
}
export function createAuditService(write:AuditWriter,executionContext?:AuditExecutionContext,report:()=>void=()=>console.error("Audit write failed.")):AuditService {
 const failed=()=>{try{report();}catch{}};
 return {record(event,headers){try{
  const record:AuditRecord={id:crypto.randomUUID(),actorId:event.actorId??"anonymous",action:event.action,resourceType:event.resourceType,resourceId:event.resourceId??null,before:safeAuditValue(event.before),after:safeAuditValue(event.after),metadata:safeAuditValue(event.metadata),ipAddress:headers?.get("cf-connecting-ip")?.slice(0,64)??null,userAgent:headers?.get("user-agent")?.slice(0,1024)??null,createdAt:new Date()};
  const task=Promise.resolve().then(()=>write(record)).catch(failed);
  try{executionContext?.waitUntil(task);}catch{failed();}
 }catch{failed();}}};
}
export interface AuditChange {operationId:string;before:unknown;after:unknown;resourceIds:readonly string[];}
export interface AuditedOperation {operationId:string;method:string;path:string;action:string;resourceType:string;}
export function beginBusinessAudit(request:Request,operations:readonly AuditedOperation[],audit:AuditService) {
 const url=new URL(request.url),started=performance.now();
 let parameters:Record<string,string>={};
 const operation=operations.find(candidate=>{
  if(candidate.method!==request.method)return false;
  const actual=url.pathname.split("/"),expected=candidate.path.split("/");
  if(actual.length!==expected.length)return false;
  const params:Record<string,string>={};
  for(let i=0;i<expected.length;i++){const segment=expected[i];if(segment.startsWith("{")&&segment.endsWith("}"))params[segment.slice(1,-1)]=actual[i];else if(segment!==actual[i])return false;}
  parameters=params;return true;
 });
 let actorId="anonymous",change:AuditChange|undefined;
 return {
  actor(id:string){actorId=id;},
  capture(value:AuditChange){if(value.operationId===operation?.operationId)change=value;},
  finish(status:number){if(operation)audit.record({actorId,action:operation.action,resourceType:operation.resourceType,resourceId:change?.resourceIds.length===1?change.resourceIds[0]:null,before:change?.before,after:change?.after,metadata:{operationId:operation.operationId,method:operation.method,path:operation.path,params:parameters,query:Object.fromEntries(url.searchParams),status,durationMs:performance.now()-started,resourceIds:change?.resourceIds??[]}},request.headers);},
 };
}
export function authAuditAction(path:string,hasNewSession:boolean,returned:unknown):string|undefined {
 if(path==="/phone-number/verify"){
  if(hasNewSession)return "auth.signin";
  if(returned&&typeof returned==="object"&&"statusCode" in returned&&Number(returned.statusCode)>=400)return "auth.signin_failed";
  return "auth.phone_verified";
 }
 if(path==="/sign-out")return "auth.signout";
 if(path.startsWith("/sign-up/"))return "auth.signup";
 if(path==="/request-password-reset")return "auth.password_reset_requested";
 if(path==="/reset-password")return "auth.password_reset";
 if(path.startsWith("/two-factor/"))return "auth.two_factor."+path.slice("/two-factor/".length).replaceAll("/",".").replaceAll("-","_");
 if(path.startsWith("/callback/")||path.startsWith("/sign-in/")){
  if(hasNewSession)return "auth.signin";
  if(returned&&typeof returned==="object"&&"statusCode" in returned&&Number(returned.statusCode)>=400)return "auth.signin_failed";
 }
 return undefined;
}
`;
const auditStore = `import {and,desc,eq,gte,lte,sql} from "drizzle-orm";
import {createDrizzleDatabase} from "../database/drizzle-database.js";
import {auditLogs} from "../database/schema/audit-schema.js";
import type {AuditWriter} from "./runtime.js";
export function createAuditWriter(connection:string):AuditWriter {
 return async event=>{await createDrizzleDatabase(connection).insert(auditLogs).values(event);};
}
export interface AuditFilters {page:number;pageSize:number;actor?:string;action?:string;from?:string;to?:string;}
export async function readAudit(connection:string,filters:AuditFilters) {
 const db=createDrizzleDatabase(connection);
 const where=and(filters.actor?eq(auditLogs.actorId,filters.actor):undefined,filters.action?eq(auditLogs.action,filters.action):undefined,filters.from?gte(auditLogs.createdAt,new Date(filters.from)):undefined,filters.to?lte(auditLogs.createdAt,new Date(filters.to)):undefined);
 const [items,count]=await db.batch([
  db.select().from(auditLogs).where(where).orderBy(desc(auditLogs.createdAt),desc(auditLogs.id)).limit(filters.pageSize).offset((filters.page-1)*filters.pageSize),
  db.select({total:sql<number>\`count(*)::int\`}).from(auditLogs).where(where),
 ]);
 return {items,total:Number(count[0]?.total??0),page:filters.page,pageSize:filters.pageSize};
}
`;
const auditSchema = `import {pgTable,uuid,text,jsonb,timestamp,index} from "drizzle-orm/pg-core";
export const auditLogs=pgTable("audit_logs",{
 id:uuid("id").primaryKey().defaultRandom(),actorId:text("actor_id").notNull(),action:text("action").notNull(),
 resourceType:text("resource_type").notNull(),resourceId:text("resource_id"),before:jsonb("before"),after:jsonb("after"),
 ipAddress:text("ip_address"),userAgent:text("user_agent"),metadata:jsonb("metadata"),
 createdAt:timestamp("created_at",{withTimezone:true,mode:"date"}).notNull().defaultNow(),
},table=>[index("audit_actor_created_idx").on(table.actorId,table.createdAt),index("audit_resource_idx").on(table.resourceType,table.resourceId),index("audit_action_created_idx").on(table.action,table.createdAt)]);
`;
