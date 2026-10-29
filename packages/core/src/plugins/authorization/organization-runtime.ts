export const organizationRuntime = `import {Client} from "@neondatabase/serverless";
import {and,eq,sql} from "drizzle-orm";import {drizzle} from "drizzle-orm/neon-serverless";
import * as schema from "../database/schema/index.js";import {createDrizzleDatabase} from "../database/drizzle-database.js";
import type {AuditEvent} from "../audit/runtime.js";import {organizationPolicy as policy} from "./organization-policy.js";
import {organizationPermissionCatalog} from "./policy.js";
const multiple=__MULTIPLE__;
const management=['org:roles:manage','org:members:manage'];
type Database=ReturnType<typeof database>;function database(client:Client){return drizzle(client,{schema});}
type Transaction=Parameters<Parameters<Database['transaction']>[0]>[0];
export class OrganizationFailure extends Error{constructor(readonly status:number,readonly code:string,message:string,readonly impact?:{token:string;lost:string[];selfLoss:string[];affected:number}){super(message);}}
function fail(status:number,code:string,message:string):never{throw new OrganizationFailure(status,code,message);}
const emit=(event:AuditEvent|undefined,capture?:((event:AuditEvent)=>void))=>{try{try{if(event)capture?.(event);}catch{console.error("Audit capture failed.");}}catch{console.error('Audit capture failed.');}};
export async function withOrganizationTransaction<T>(connection:string,organizationId:string,run:(tx:Transaction)=>Promise<T>):Promise<T>{
 const client=new Client({connectionString:connection});const proxy=process.env.NEON_HTTP_PROXY_URL;
 if(proxy||new URL(connection).hostname.endsWith('.localtest.me')){const endpoint=new URL(proxy??'http://127.0.0.1:4444/sql');if(endpoint.protocol!=='http:'||endpoint.username||endpoint.password)throw Error('A local HTTP Neon proxy is required.');client.neonConfig.wsProxy=()=>endpoint.host+'/v2';client.neonConfig.useSecureWebSocket=false;client.neonConfig.pipelineConnect=false;}
 try{await client.connect();return await database(client).transaction(async tx=>{await tx.execute(sql\`SELECT pg_advisory_xact_lock(197708,hashtext(\${organizationId}))\`);return run(tx);},{isolationLevel:'read committed'});}finally{await client.end();}
}
interface Role{id:string;name:string;description:string|null;is_system:boolean;permissions:string[];}
interface Member{id:string;user_id:string;active:boolean;roles:string[];}
interface State{roles:Role[];members:Member[];}
async function snapshot(tx:Transaction,organizationId:string):Promise<State>{
 const result=await tx.execute(sql\`SELECT
 coalesce((SELECT json_agg(r ORDER BY r.id) FROM(SELECT r.id,r.name,r.description,r.is_system,coalesce(array_agg(p.permission ORDER BY p.permission) FILTER(WHERE p.permission IS NOT NULL),'{}') AS permissions FROM auth_org_roles r LEFT JOIN auth_org_role_permissions p ON p.org_role_id=r.id WHERE r.organization_id=\${organizationId} GROUP BY r.id)r),'[]') AS roles,
 coalesce((SELECT json_agg(m ORDER BY m.id) FROM(SELECT m.id,m.user_id,m.active,\${multiple?sql\`coalesce(array_agg(mr.role_id ORDER BY mr.role_id) FILTER(WHERE mr.role_id IS NOT NULL),'{}')\`:sql\`ARRAY[m.role]\`} AS roles FROM member m \${multiple?sql\`LEFT JOIN auth_member_roles mr ON mr.member_id=m.id AND mr.organization_id=m.organization_id\`:sql\`\`} WHERE m.organization_id=\${organizationId} GROUP BY m.id)m),'[]') AS members\`);
 return result.rows[0] as unknown as State;
}
const grants=(state:State,member:Member|undefined)=>new Set(member?.active?state.roles.filter(role=>member.roles.includes(role.id)).flatMap(role=>role.permissions):[]);
const has=(permissions:ReadonlySet<string>,permission:string)=>permissions.has('*')||permissions.has(permission);
async function requireActor(tx:Transaction,organizationId:string,actor:string,permission:string){const state=await snapshot(tx,organizationId),member=state.members.find(member=>member.user_id===actor);if(!member?.active)fail(403,'TENANT_MEMBERSHIP_REQUIRED','An active organization membership is required.');if(!has(grants(state,member),permission))fail(403,'forbidden','The organization permission is required.');return state;}
const systemRole=(organizationId:string,name:string)=>organizationId+':'+name;
function checkedRoles(state:State,ids:string[]):string[]{const roles=[...new Set(ids)].sort();if(!roles.length||roles.length!==ids.length||roles.length>100||(!multiple&&roles.length!==1)||roles.some(id=>!state.roles.some(role=>role.id===id)))fail(400,'invalid_roles','Select existing roles from this organization and respect its role mode.');return roles;}
function checkedPermissions(values:string[]):string[]{const permissions=[...new Set(values)].sort();if(permissions.length!==values.length||permissions.some(value=>!organizationPermissionCatalog.includes(value as never)))fail(400,'invalid_permissions','Use concrete permissions from this organization catalog.');return permissions;}
async function protectChange(state:State,next:State,organizationId:string,actor:string,request:Record<string,unknown>,confirmation?:string){
 if(!next.members.some(member=>management.every(permission=>has(grants(next,member),permission))))fail(409,'last_admin','Keep at least one active organization administrator.');
 const losses=state.members.map(member=>({id:member.user_id,lost:management.filter(permission=>has(grants(state,member),permission)&&!has(grants(next,next.members.find(value=>value.id===member.id)),permission))})).filter(value=>value.lost.length);
 if(!losses.length)return;
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({organizationId,actor,request,state})));
 const token=Array.from(new Uint8Array(digest),value=>value.toString(16).padStart(2,'0')).join('');
 if(confirmation!==token)throw new OrganizationFailure(409,'confirmation_required','Review the members losing administrative access.',{token,lost:[...new Set(losses.flatMap(value=>value.lost))],selfLoss:losses.find(value=>value.id===actor)?.lost??[],affected:losses.length});
}
async function assign(tx:Transaction,organizationId:string,memberId:string,roles:string[]){
 await tx.update(schema.member).set({role:roles[0]}).where(and(eq(schema.member.id,memberId),eq(schema.member.organizationId,organizationId)));
 if(multiple){await tx.execute(sql\`DELETE FROM auth_member_roles WHERE member_id=\${memberId} AND organization_id=\${organizationId}\`);await tx.execute(sql\`INSERT INTO auth_member_roles(member_id,role_id,organization_id) SELECT \${memberId},r.value,\${organizationId} FROM jsonb_array_elements_text(\${JSON.stringify(roles)}::jsonb)r(value)\`);}
}
export function organizationRepository(connection:string){const db=createDrizzleDatabase(connection);return {
 async list(actor:string){const result=await db.execute(sql\`SELECT o.id,o.name,o.slug FROM organization o JOIN member m ON m.organization_id=o.id WHERE m.user_id=\${actor} AND m.active=true ORDER BY o.name,o.id\`);return result.rows;},
 async create(actor:string,sessionId:string,input:{name:string;slug:string},capture?:(event:AuditEvent)=>void){
 const id=crypto.randomUUID();const result=await withOrganizationTransaction(connection,id,async tx=>{
 await tx.insert(schema.organization).values({id,...input});
 const roles=policy.roles.map(name=>({id:systemRole(id,name),organization_id:id,name,is_system:name===policy.ownerRole||name===policy.defaultRole}));
 await tx.insert(schema.authOrgRoles).values(roles);
 const permissions=roles.flatMap(role=>(role.name===policy.ownerRole?['*']:((policy.rolePermissions as Record<string,readonly string[]>)[role.name]??[])).map(permission=>({id:crypto.randomUUID(),org_role_id:role.id,permission})));
 if(permissions.length)await tx.insert(schema.authOrgRolePermissions).values(permissions);
 const memberId=crypto.randomUUID(),owner=systemRole(id,policy.ownerRole);await tx.insert(schema.member).values({id:memberId,organizationId:id,userId:actor,role:owner,active:true});await assign(tx,id,memberId,[owner]);
 await tx.update(schema.session).set({activeOrganizationId:id}).where(and(eq(schema.session.id,sessionId),eq(schema.session.userId,actor)));return {id,...input};
 });emit({actorId:actor,action:'organization.created',resourceType:'organization',resourceId:id,before:null,after:result},capture);return result;
 },
 async activate(actor:string,sessionId:string,organizationId:string){await withOrganizationTransaction(connection,organizationId,async tx=>{const state=await snapshot(tx,organizationId);if(!state.members.some(member=>member.user_id===actor&&member.active))fail(403,'TENANT_MEMBERSHIP_REQUIRED','An active organization membership is required.');await tx.update(schema.session).set({activeOrganizationId:organizationId}).where(and(eq(schema.session.id,sessionId),eq(schema.session.userId,actor)));});return {organizationId};},
 async roles(organizationId:string,actor:string,options=false){return withOrganizationTransaction(connection,organizationId,async tx=>{const state=await requireActor(tx,organizationId,actor,options?'org:members:manage':'org:roles:manage');return state.roles.map(role=>({id:role.id,name:role.name,description:role.description,isSystem:role.is_system,...(options?{}:{permissions:role.permissions})}));});},
 async members(organizationId:string,actor:string,page:number,pageSize:number){return withOrganizationTransaction(connection,organizationId,async tx=>{const state=await requireActor(tx,organizationId,actor,'org:members:manage');const result=await tx.execute(sql\`SELECT m.id,u.id AS "userId",u.name,u.email,m.active FROM member m JOIN auth_user u ON u.id=m.user_id WHERE m.organization_id=\${organizationId} ORDER BY m.id LIMIT \${pageSize} OFFSET \${(page-1)*pageSize}\`);return {items:result.rows.map(row=>({...row,roles:state.members.find(member=>member.id===row.id)?.roles??[]})),total:state.members.length,page,pageSize};});},
 async createRole(organizationId:string,actor:string,input:{name:string;description?:string|null;permissions:string[]},capture?:(event:AuditEvent)=>void){const id=crypto.randomUUID();await withOrganizationTransaction(connection,organizationId,async tx=>{await requireActor(tx,organizationId,actor,'org:roles:manage');const permissions=checkedPermissions(input.permissions);await tx.insert(schema.authOrgRoles).values({id,organization_id:organizationId,name:input.name,description:input.description??null});if(permissions.length)await tx.insert(schema.authOrgRolePermissions).values(permissions.map(permission=>({id:crypto.randomUUID(),org_role_id:id,permission})));});emit({actorId:actor,action:'organization.role.created',resourceType:'organization-role',resourceId:id,before:null,after:{organizationId,...input}},capture);return {id};},
 async change(organizationId:string,actor:string,input:{kind:'role'|'member'|'remove';id:string;name?:string;description?:string|null;permissions?:string[];roles?:string[];confirmation?:string},capture?:(event:AuditEvent)=>void){
 let event:AuditEvent|undefined;
 await withOrganizationTransaction(connection,organizationId,async tx=>{const state=await requireActor(tx,organizationId,actor,input.kind==='role'?'org:roles:manage':'org:members:manage');
 const role=state.roles.find(role=>role.id===input.id),member=state.members.find(member=>member.id===input.id);
 if(input.kind==='role'?!role:!member)fail(404,'not_found','The role or member does not exist in this organization.');
 let next=state;
 if(input.kind==='role'){
 const permissions=input.permissions?(role!.id===systemRole(organizationId,policy.ownerRole)&&input.permissions.length===1&&input.permissions[0]==='*'?['*']:checkedPermissions(input.permissions)):role!.permissions;
 if((role!.id===systemRole(organizationId,policy.ownerRole)&&!permissions.includes('*'))||(role!.id===systemRole(organizationId,policy.defaultRole)&&management.some(permission=>has(new Set(permissions),permission))))fail(400,'protected','The owner/default role cannot be degraded or made unsafe.');
 next={...state,roles:state.roles.map(value=>value.id===input.id?{...value,permissions}:value)};
 }else {const roles=input.kind==='remove'?[]:checkedRoles(state,input.roles??[]);next={...state,members:input.kind==='remove'?state.members.filter(value=>value.id!==input.id):state.members.map(value=>value.id===input.id?{...value,roles}:value)};}
 const {confirmation,...request}=input;await protectChange(state,next,organizationId,actor,request,confirmation);
 if(input.kind==='role'){
 await tx.update(schema.authOrgRoles).set({name:input.name??role!.name,description:input.description===undefined?role!.description:input.description,updated_at:new Date()}).where(and(eq(schema.authOrgRoles.id,input.id),eq(schema.authOrgRoles.organization_id,organizationId)));
 if(input.permissions){await tx.delete(schema.authOrgRolePermissions).where(eq(schema.authOrgRolePermissions.org_role_id,input.id));if(input.permissions.length)await tx.insert(schema.authOrgRolePermissions).values(input.permissions.map(permission=>({id:crypto.randomUUID(),org_role_id:input.id,permission})));}
 }else if(input.kind==='remove')await tx.delete(schema.member).where(and(eq(schema.member.id,input.id),eq(schema.member.organizationId,organizationId)));
 else await assign(tx,organizationId,input.id,next.members.find(value=>value.id===input.id)!.roles);
 event={actorId:actor,action:'organization.'+input.kind+'.updated',resourceType:'organization-'+input.kind,resourceId:input.id,before:input.kind==='role'?role:member,after:{organizationId,...request}};
 });emit(event,capture);return {ok:true};
 },
 async deleteRole(organizationId:string,actor:string,id:string,capture?:(event:AuditEvent)=>void){let before:Role|undefined;await withOrganizationTransaction(connection,organizationId,async tx=>{const state=await requireActor(tx,organizationId,actor,'org:roles:manage');before=state.roles.find(role=>role.id===id);if(!before)fail(404,'not_found','Role not found in this organization.');if(before.is_system||id===systemRole(organizationId,policy.ownerRole)||id===systemRole(organizationId,policy.defaultRole))fail(409,'protected','System roles cannot be deleted.');if(state.members.some(member=>member.roles.includes(id)))fail(409,'role_in_use','Remove this role from members first.');const invites=await tx.execute(sql\`SELECT id FROM invitation WHERE organization_id=\${organizationId} AND status='pending' AND expires_at>now() AND \${id}=ANY(string_to_array(role,',')) LIMIT 1\`);if(invites.rows.length)fail(409,'role_in_use','This role is assigned to a pending invitation.');await tx.delete(schema.authOrgRoles).where(and(eq(schema.authOrgRoles.id,id),eq(schema.authOrgRoles.organization_id,organizationId)));});emit({actorId:actor,action:'organization.role.deleted',resourceType:'organization-role',resourceId:id,before,after:{organizationId}},capture);return {ok:true};},
 async invite(organizationId:string,actor:string,input:{email:string;roles:string[]},capture?:(event:AuditEvent)=>void){
 const token=Array.from(crypto.getRandomValues(new Uint8Array(32)),value=>value.toString(16).padStart(2,'0')).join(''),hash=await digest(token);const email=input.email.trim().toLowerCase();
 const result=await withOrganizationTransaction(connection,organizationId,async tx=>{const state=await requireActor(tx,organizationId,actor,'org:members:manage'),roles=checkedRoles(state,input.roles);
 const existing=await tx.execute(sql\`SELECT id FROM invitation WHERE organization_id=\${organizationId} AND email=\${email} AND status='pending' ORDER BY id LIMIT 1\`),id=String(existing.rows[0]?.id??crypto.randomUUID());
 const values={organizationId,email,role:roles.join(','),status:'pending',expiresAt:new Date(Date.now()+7*86400000),inviterId:actor,tokenHash:hash};
 if(existing.rows.length)await tx.update(schema.invitation).set(values).where(and(eq(schema.invitation.id,id),eq(schema.invitation.organizationId,organizationId)));else await tx.insert(schema.invitation).values({id,...values});return {id,email};
 });emit({actorId:actor,action:'organization.invitation.created',resourceType:'organization-invitation',resourceId:result.id,before:null,after:{organizationId,email}},capture);return {...result,token};
 },
 async accept(actor:string,sessionId:string,token:string,capture?:(event:AuditEvent)=>void){const hash=await digest(token);const found=await db.execute(sql\`SELECT organization_id FROM invitation WHERE token_hash=\${hash} AND status='pending' AND expires_at>now() LIMIT 1\`);if(!found.rows[0])fail(400,'invitation_invalid','The invitation is expired or unavailable.');const organizationId=String(found.rows[0].organization_id);
 await withOrganizationTransaction(connection,organizationId,async tx=>{const result=await tx.execute(sql\`SELECT i.id,i.email,i.role,u.email AS user_email FROM invitation i CROSS JOIN auth_user u WHERE i.token_hash=\${hash} AND i.organization_id=\${organizationId} AND i.status='pending' AND i.expires_at>now() AND u.id=\${actor} FOR UPDATE OF i\`),row=result.rows[0];if(!row||String(row.email).toLowerCase()!==String(row.user_email).toLowerCase())fail(403,'invitation_invalid','Sign in with the invited email address.');const state=await snapshot(tx,organizationId);if(state.members.some(member=>member.user_id===actor))fail(409,'already_member','This account is already a member.');const roles=checkedRoles(state,String(row.role).split(',')),id=crypto.randomUUID();await tx.insert(schema.member).values({id,organizationId,userId:actor,role:roles[0],active:true});await assign(tx,organizationId,id,roles);await tx.update(schema.invitation).set({status:'accepted'}).where(and(eq(schema.invitation.id,String(row.id)),eq(schema.invitation.organizationId,organizationId)));await tx.update(schema.session).set({activeOrganizationId:organizationId}).where(and(eq(schema.session.id,sessionId),eq(schema.session.userId,actor)));});emit({actorId:actor,action:'organization.invitation.accepted',resourceType:'organization',resourceId:organizationId,before:null,after:{organizationId}},capture);return {organizationId};
 }
};}
async function digest(token:string){const value=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token));return Array.from(new Uint8Array(value),byte=>byte.toString(16).padStart(2,'0')).join('');}
`;
