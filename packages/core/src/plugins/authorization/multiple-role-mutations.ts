import { iamMutations } from "./iam-mutations.js";

// Share the established request-scoped transaction/connection boundary with single-role IAM.
const transaction = iamMutations
  .slice(0, iamMutations.indexOf("async function snapshot"))
  .replace("role?:string;", "role?:string; roles?:string[];");

export const multipleRoleMutations = `${transaction}
export async function assignDefaultGlobalRole(connection:string,userId:string,roleId:string):Promise<void>{await withIamTransaction(connection,async tx=>{await tx.insert(schema.authUserRoles).values({user_id:userId,role_id:roleId}).onConflictDoNothing();});}
interface StateRole {id:string;name:string;description:string|null;is_system:boolean;permissions:string[];}
interface StateUser {id:string;roles:string[];}
async function snapshot(tx:Transaction):Promise<{roles:StateRole[];users:StateUser[]}>{
 const result=await tx.execute(sql\`SELECT
 coalesce((SELECT json_agg(r ORDER BY r.id) FROM (SELECT r.*,coalesce(array_agg(p.permission ORDER BY p.permission) FILTER(WHERE p.permission IS NOT NULL),'{}') AS permissions FROM auth_roles r LEFT JOIN auth_role_permissions p ON p.role_id=r.id GROUP BY r.id) r),'[]') AS roles,
 coalesce((SELECT json_agg(u ORDER BY u.id) FROM (SELECT u.id,coalesce(array_agg(ur.role_id ORDER BY ur.role_id) FILTER(WHERE ur.role_id IS NOT NULL),'{}') AS roles FROM auth_user u LEFT JOIN auth_user_roles ur ON ur.user_id=u.id GROUP BY u.id) u),'[]') AS users\`);
 return result.rows[0] as unknown as {roles:StateRole[];users:StateUser[]};
}
const grants=(roles:readonly StateRole[],ids:readonly string[])=>new Set(roles.filter(role=>ids.includes(role.id)).flatMap(role=>role.permissions));
const allowed=(values:ReadonlySet<string>,permission:string)=>values.has('*')||values.has(permission);
export async function createRole(connection:string,role:RoleInput,actor:string,capture?:(event:AuditEvent)=>void):Promise<'ok'|'forbidden'|'conflict'>{
 let event:AuditEvent|undefined;
 const outcome=await withIamTransaction(connection,async tx=>{
 const state=await snapshot(tx),user=state.users.find(user=>user.id===actor);
 if(!allowed(grants(state.roles,user?.roles??[]),'iam:roles:manage'))return 'forbidden';
 if(state.roles.some(value=>value.id===role.id))return 'conflict';
 if(role.permissions.includes('*'))return 'forbidden';
 await tx.insert(schema.authRoles).values({id:role.id,name:role.name,description:role.description??null});
 if(role.permissions.length)await tx.insert(schema.authRolePermissions).values(role.permissions.map(permission=>({id:crypto.randomUUID(),role_id:role.id,permission})));
 event={actorId:actor,action:'iam.role.created',resourceType:'role',resourceId:role.id,before:null,after:role};return 'ok';
 });try{if(event)capture?.(event);}catch{console.error("Audit capture failed.");}return outcome;
}
export async function deleteRole(connection:string,id:string,actor:string,defaultRole:string,adminRole:string,capture?:(event:AuditEvent)=>void):Promise<'ok'|'forbidden'|'protected'|'role_in_use'|'not_found'>{
 let event:AuditEvent|undefined;
 const outcome=await withIamTransaction(connection,async tx=>{
 const state=await snapshot(tx),user=state.users.find(user=>user.id===actor),role=state.roles.find(role=>role.id===id);
 if(!allowed(grants(state.roles,user?.roles??[]),'iam:roles:manage'))return 'forbidden';
 if(!role)return 'not_found';if(role.is_system||id===defaultRole||id===adminRole)return 'protected';
 if(state.users.some(user=>user.roles.includes(id)))return 'role_in_use';
 await tx.delete(schema.authRoles).where(eq(schema.authRoles.id,id));event={actorId:actor,action:'iam.role.deleted',resourceType:'role',resourceId:id,before:role,after:null};return 'ok';
 });try{if(event)capture?.(event);}catch{console.error("Audit capture failed.");}return outcome;
}
export async function changeAccess(connection:string,change:AccessChange,defaultRole:string,adminRole:string,capture?:(event:AuditEvent)=>void):Promise<AccessResult>{
 let event:AuditEvent|undefined;
 const result=await withIamTransaction<AccessResult>(connection,async tx=>{
 const state=await snapshot(tx),actor=state.users.find(user=>user.id===change.actor);
 const base:AccessResult={code:'ok',token:'',selfLoss:[],lost:[],affected:0};
 if(!allowed(grants(state.roles,actor?.roles??[]),change.kind==='role'?'iam:roles:manage':'iam:users:manage-roles'))return {...base,code:'forbidden'};
 const role=state.roles.find(role=>role.id===change.id),user=state.users.find(user=>user.id===change.id);
 const roles=change.roles??(change.role?[change.role]:[]);
 if(change.kind==='role'?!role:!user||!roles.length||new Set(roles).size!==roles.length||roles.some(id=>!state.roles.some(role=>role.id===id)))return {...base,code:'not_found'};
 const next=change.permissions??role?.permissions??[];
 if(change.kind==='role'&&((role!.id===adminRole&&!next.includes('*'))||(role!.id!==adminRole&&next.includes('*'))||(role!.id===defaultRole&&management.some(permission=>allowed(new Set(next),permission)))))return {...base,code:'protected'};
 const nextRoles=state.roles.map(value=>change.kind==='role'&&value.id===change.id?{...value,permissions:next}:value);
 const nextUsers=state.users.map(value=>change.kind==='user'&&value.id===change.id?{...value,roles:[...roles].sort()}:value);
 const losses=state.users.map(value=>{const after=nextUsers.find(next=>next.id===value.id)!;const before=grants(state.roles,value.roles),afterGrants=grants(nextRoles,after.roles);return {id:value.id,lost:management.filter(permission=>allowed(before,permission)&&!allowed(afterGrants,permission))};});
 if(!nextUsers.some(value=>management.every(permission=>allowed(grants(nextRoles,value.roles),permission))))return {...base,code:'last_admin'};
 const affected=losses.filter(value=>value.lost.length);base.affected=affected.length;base.lost=[...new Set(affected.flatMap(value=>value.lost))];base.selfLoss=affected.find(value=>value.id===change.actor)?.lost??[];
 const {confirmation:_confirmation,...request}=change;const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({request:{...request,roles:[...roles].sort(),permissions:change.permissions?[...change.permissions].sort():null},state})));
 base.token=Array.from(new Uint8Array(digest),value=>value.toString(16).padStart(2,'0')).join('');
 if(affected.length&&change.confirmation!==base.token)return {...base,code:'confirmation_required'};
 if(change.kind==='role'){
 await tx.update(schema.authRoles).set({name:change.name??role!.name,description:change.description===undefined?role!.description:change.description,updated_at:new Date()}).where(eq(schema.authRoles.id,change.id));
 if(change.permissions){await tx.delete(schema.authRolePermissions).where(eq(schema.authRolePermissions.role_id,change.id));if(next.length)await tx.insert(schema.authRolePermissions).values(next.map(permission=>({id:crypto.randomUUID(),role_id:change.id,permission})));}
 }else{
 await tx.delete(schema.authUserRoles).where(eq(schema.authUserRoles.user_id,change.id));
 await tx.insert(schema.authUserRoles).values(roles.map(role_id=>({user_id:change.id,role_id})));
 }
 event={actorId:change.actor,action:change.kind==='role'?'iam.role.updated':'iam.user.roles_assigned',resourceType:change.kind,resourceId:change.id,before:change.kind==='role'?role:user,after:change.kind==='role'?nextRoles.find(value=>value.id===change.id):{roles}};return base;
 });try{if(event)capture?.(event);}catch{console.error("Audit capture failed.");}return result;
}
`;
