/** Interactive transactions keep IAM guards and writes under one advisory lock. */
export const iamMutations = `import { Client } from "@neondatabase/serverless";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-serverless";
import * as schema from "../database/schema/index.js";
import { isAuthorized, type Permission } from "./policy.js";

export interface AccessChange { kind:"role"|"user"; id:string; actor:string; confirmation?:string; role?:string; name?:string; description?:string|null; permissions?:string[]; }
export interface AccessResult { code:"ok"|"not_found"|"forbidden"|"protected"|"last_admin"|"confirmation_required"; token:string; selfLoss:string[]; lost:string[]; affected:number; }
export interface RoleInput { id:string; name:string; description?:string|null; permissions:string[]; }
const management = ["iam:roles:manage", "iam:users:manage-roles"] as const;
type Database = ReturnType<typeof database>;
function database(client:Client) { return drizzle(client,{schema}); }
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** One connection per request, closed before returning, including on errors (Workers compatible). */
export async function withIamTransaction<T>(connectionString:string, run:(tx:Transaction)=>Promise<T>):Promise<T> {
 const client=new Client({connectionString});
 const localProxy=process.env.NEON_HTTP_PROXY_URL;
 const hostname=new URL(connectionString).hostname;
 if(localProxy || hostname.endsWith(".localtest.me")) {
  const endpoint=new URL(localProxy??"http://127.0.0.1:4444/sql");
  if(endpoint.protocol!=="http:"||endpoint.username||endpoint.password)throw Error("NEON_HTTP_PROXY_URL must be a local HTTP endpoint without credentials.");
  client.neonConfig.wsProxy=()=>endpoint.host+"/v2";
  client.neonConfig.useSecureWebSocket=false;
  client.neonConfig.pipelineConnect=false;
 }
 try {
  await client.connect();
  return await database(client).transaction(async tx=>{
   // READ COMMITTED: every read after waiting for the lock observes the preceding commit.
   await tx.execute(sql\`SELECT pg_advisory_xact_lock(197707,97)\`);
   return run(tx);
  },{isolationLevel:"read committed"});
 } finally { await client.end(); }
}

async function snapshot(tx:Transaction) {
 const roles=await tx.select().from(schema.authRoles).orderBy(schema.authRoles.id);
 const grants=await tx.select().from(schema.authRolePermissions).orderBy(schema.authRolePermissions.role_id,schema.authRolePermissions.permission);
 const users=await tx.select({id:schema.authUser.id,role:schema.authUser.role}).from(schema.authUser).orderBy(schema.authUser.id);
 return {roles:roles.map(role=>({...role,permissions:grants.filter(grant=>grant.role_id===role.id).map(grant=>grant.permission)})),users};
}
const authorized=(permissions:readonly string[],permission:Permission)=>isAuthorized({permissions},{permissions:[permission]});
async function requireActor(tx:Transaction,actor:string,permission:Permission) {
 const state=await snapshot(tx);
 const user=state.users.find(user=>user.id===actor);
 const role=state.roles.find(role=>role.id===user?.role);
 return {state,allowed:authorized(role?.permissions??[],permission)};
}
export async function createRole(connection:string,role:RoleInput,actor:string):Promise<"ok"|"forbidden"|"conflict"> {
 return withIamTransaction(connection,async tx=>{
  const {state,allowed}=await requireActor(tx,actor,"iam:roles:manage");
  if(!allowed)return "forbidden";
  if(state.roles.some(existing=>existing.id===role.id))return "conflict";
  await tx.insert(schema.authRoles).values({id:role.id,name:role.name,description:role.description??null});
  if(role.permissions.length)await tx.insert(schema.authRolePermissions).values(role.permissions.map(permission=>({id:crypto.randomUUID(),role_id:role.id,permission})));
  return "ok";
 });
}
export async function deleteRole(connection:string,id:string,actor:string,defaultRole:string,adminRole:string):Promise<"ok"|"forbidden"|"protected"|"role_in_use"|"not_found"> {
 return withIamTransaction(connection,async tx=>{
  const {state,allowed}=await requireActor(tx,actor,"iam:roles:manage");
  if(!allowed)return "forbidden";
  const role=state.roles.find(role=>role.id===id);
  if(!role)return "not_found";
  if(role.is_system||id===adminRole||id===defaultRole)return "protected";
  if(state.users.some(user=>user.role===id))return "role_in_use";
  await tx.delete(schema.authRoles).where(eq(schema.authRoles.id,id));
  return "ok";
 });
}
export async function changeAccess(connection:string,change:AccessChange,defaultRole:string,adminRole:string):Promise<AccessResult> {
 return withIamTransaction(connection,async tx=>{
  const {state,allowed}=await requireActor(tx,change.actor,change.kind==="role"?"iam:roles:manage":"iam:users:manage-roles");
  const result:AccessResult={code:"ok",token:"",selfLoss:[],lost:[],affected:0};
  if(!allowed)return {...result,code:"forbidden"};
  const targetUser=state.users.find(user=>user.id===change.id);
  const target=state.roles.find(role=>role.id===(change.kind==="role"?change.id:targetUser?.role));
  const destination=state.roles.find(role=>role.id===change.role);
  if(!target||(change.kind==="user"&&!destination))return {...result,code:"not_found"};
  const next=change.kind==="role"?(change.permissions??target.permissions):destination!.permissions;
  if(change.kind==="role"&&((target.id===defaultRole&&next.some(p=>p==="*"||management.some(m=>m===p)))||(target.id===adminRole&&!next.includes("*"))||(!target.permissions.includes("*")&&next.includes("*"))))return {...result,code:"protected"};
  const affected=state.users.filter(user=>change.kind==="role"?user.role===target.id:user.id===change.id);
  const affectedIds=new Set(affected.map(user=>user.id));
  const lost=management.filter(permission=>authorized(target.permissions,permission)&&!authorized(next,permission));
  const actor=state.users.find(user=>user.id===change.actor);
  result.affected=affected.length;result.lost=[...lost];
  result.selfLoss=(change.kind==="role"?actor?.role===target.id:change.id===change.actor)?[...lost]:[];
  const hasAdmin=state.users.some(user=>{
   const grants=affectedIds.has(user.id)?next:state.roles.find(role=>role.id===user.role)?.permissions??[];
   return management.every(permission=>authorized(grants,permission));
  });
  if(!hasAdmin)return {...result,code:"last_admin"};
  // Canonical, state-bound, actor-bound token; never replay a stale confirmation after a concurrent edit.
  const {confirmation:_confirmation,...request}=change;
  const canonical={request:{kind:request.kind,id:request.id,actor:request.actor,role:request.role??null,name:request.name??null,description:request.description===undefined?{unchanged:true}:request.description,permissions:request.permissions?[...request.permissions].sort():null},state};
  const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify(canonical)));
  result.token=Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,"0")).join("");
  if(lost.length&&affected.length&&change.confirmation!==result.token)return {...result,code:"confirmation_required"};
  if(change.kind==="role") {
   await tx.update(schema.authRoles).set({name:change.name??target.name,description:change.description===undefined?target.description:change.description,updated_at:new Date()}).where(eq(schema.authRoles.id,change.id));
   if(change.permissions) {
    await tx.delete(schema.authRolePermissions).where(eq(schema.authRolePermissions.role_id,change.id));
    if(next.length)await tx.insert(schema.authRolePermissions).values(next.map(permission=>({id:crypto.randomUUID(),role_id:change.id,permission})));
   }
  } else {
   await tx.update(schema.authUser).set({role:change.role!,updatedAt:new Date()}).where(and(eq(schema.authUser.id,change.id),eq(schema.authUser.role,target.id)));
  }
  return result;
 });
}
`;
