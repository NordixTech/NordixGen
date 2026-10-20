/** IAM is mounted and described by Better Auth, with live database authorization. */
export const iamPlugin = `import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint, createAuthMiddleware, sessionMiddleware } from "better-auth/api";
import { z } from "zod";
import {createDrizzleDatabase} from "../database/drizzle-database.js";
import { createIamRepository } from "../authorization/repository.js";
import { changeAccess, createRole, deleteRole, type AccessResult } from "../authorization/mutations.js";
import { isAuthorized, permissions, type Permission } from "../authorization/policy.js";

export function nordixIamPlugin(config:{connectionString:string;defaultRole:string;adminRole:string;trustedOrigins:readonly string[]}) {
 const repository=createIamRepository(createDrizzleDatabase(config.connectionString));
 const slug=z.string().regex(/^[a-z][a-z0-9-]*$/).max(100);
 const grants=z.array(z.string()).max(500).refine(values=>new Set(values).size===values.length&&values.every(value=>value==="*"||permissions.includes(value as Permission)),"Unknown or duplicate permission.");
 const body=z.object({name:z.string().trim().min(1).max(200),description:z.string().max(2000).nullable().optional(),permissions:grants}).strict();
 const member=createAuthMiddleware(async ctx=>{
  const session=ctx.context.session;
  if(!session)throw new APIError("UNAUTHORIZED",{message:"A verified session is required."});
  const principal=await repository.principal(session.user.id);
  if(!principal)throw new APIError("FORBIDDEN",{message:"The account has no active role."});
  ctx.setHeader("Cache-Control","no-store");
  if(ctx.request && !["GET","HEAD"].includes(ctx.request.method)) {
   const origin=ctx.headers?.get("origin");
   if(!origin||!config.trustedOrigins.includes(origin))throw new APIError("FORBIDDEN",{message:"A trusted Origin header is required."});
  }
  return {principal};
 });
 const use=[sessionMiddleware,member];
 const check=(principal:{permissions:string[]},permission:Permission)=>{
  if(!isAuthorized(principal,{permissions:[permission]}))throw new APIError("FORBIDDEN",{message:"Required IAM permission is missing."});
 };
 const response=(result:AccessResult)=>{
  if(result.code==="ok")return Response.json({ok:true});
  const detail=result.code==="last_admin"?"Keep at least one user with both role management and user role assignment permissions. Assign another administrator first.":result.code==="confirmation_required"?"This change removes administrative access. Review its impact before continuing.":result.code==="forbidden"?"Your administrative access has changed. Refresh and try again.":result.code==="protected"?"Invalid permissions or protected system role.":"User or role does not exist.";
  const status=result.code==="not_found"?404:result.code==="forbidden"?403:result.code==="protected"?400:409;
  return Response.json({title:"Access change",status,detail,...result},{status});
 };
 return {
  id:"nordix-iam",
  schema:{
   user:{fields:{role:{type:"string",required:true,defaultValue:config.defaultRole,input:false,references:{model:"authRoles",field:"id",onDelete:"restrict"}}}},
   authRoles:{modelName:"auth_roles",fields:{
    name:{type:"string",required:true},description:{type:"string",required:false},
    isSystem:{type:"boolean",required:true,defaultValue:false,fieldName:"is_system",input:false},
    createdAt:{type:"date",required:true,defaultValue:()=>new Date(),fieldName:"created_at"},
    updatedAt:{type:"date",required:true,defaultValue:()=>new Date(),fieldName:"updated_at"},
   }},
   authRolePermissions:{modelName:"auth_role_permissions",fields:{
    roleId:{type:"string",required:true,fieldName:"role_id",references:{model:"authRoles",field:"id",onDelete:"cascade"}},
    permission:{type:"string",required:true},
   },indexes:[{fields:["roleId","permission"],unique:true}]},
  },
  endpoints:{
   iamGetMe:createAuthEndpoint("/iam/me",{method:"GET",use},async ctx=>ctx.json(ctx.context.principal)),
   iamPermissions:createAuthEndpoint("/iam/permissions",{method:"GET",use},async ctx=>{check(ctx.context.principal,"iam:roles:manage");return ctx.json(permissions);}),
   iamListRoles:createAuthEndpoint("/iam/roles",{method:"GET",use},async ctx=>{check(ctx.context.principal,"iam:roles:manage");return ctx.json(await repository.roles());}),
   iamRoleOptions:createAuthEndpoint("/iam/role-options",{method:"GET",use},async ctx=>{check(ctx.context.principal,"iam:users:manage-roles");return ctx.json((await repository.roles()).map(({id,name})=>({id,name})));}),
   iamListUsers:createAuthEndpoint("/iam/users",{method:"GET",use,query:z.object({page:z.coerce.number().int().min(1).max(100000).default(1),pageSize:z.coerce.number().int().min(1).max(100).default(25)}).strict()},async ctx=>{
    check(ctx.context.principal,"iam:users:manage-roles");const {page,pageSize}=ctx.query;
    return ctx.json({...await repository.users(pageSize,(page-1)*pageSize),page,pageSize});
   }),
   iamCreateRole:createAuthEndpoint("/iam/roles",{method:"POST",use,body:body.extend({id:slug})},async ctx=>{
    check(ctx.context.principal,"iam:roles:manage");
    if(ctx.body.permissions.includes("*")||(ctx.body.id===config.defaultRole&&ctx.body.permissions.some(p=>p==="iam:roles:manage"||p==="iam:users:manage-roles")))throw new APIError("BAD_REQUEST",{code:"protected",message:"Provide known concrete permissions."});
    const result=await createRole(config.connectionString,ctx.body,ctx.context.principal.id);
    if(result==="forbidden")throw new APIError("FORBIDDEN",{code:result,message:"Your administrative access has changed."});
    if(result!=="ok")throw new APIError("CONFLICT",{message:"Role already exists."});
    ctx.setStatus(201);return ctx.json({id:ctx.body.id});
   }),
   iamUpdateRole:createAuthEndpoint("/iam/roles/:id",{method:"PUT",use,body:body.partial().extend({confirmation:z.string().max(100).optional()}).refine(value=>Object.keys(value).some(key=>key!=="confirmation"))},async ctx=>{
    check(ctx.context.principal,"iam:roles:manage");return response(await changeAccess(config.connectionString,{kind:"role",id:ctx.params.id,actor:ctx.context.principal.id,...ctx.body},config.defaultRole,config.adminRole));
   }),
   iamDeleteRole:createAuthEndpoint("/iam/roles/:id",{method:"DELETE",disableBody:true,use},async ctx=>{
    check(ctx.context.principal,"iam:roles:manage");
    const result=await deleteRole(config.connectionString,ctx.params.id,ctx.context.principal.id,config.defaultRole,config.adminRole);
    if(result==="forbidden")throw new APIError("FORBIDDEN",{code:result,message:"Your administrative access has changed."});
    if(result!=="ok")throw new APIError("CONFLICT",{code:result,message:"Role is missing, protected, or assigned to users."});
    return new Response(null,{status:204});
   }),
   iamAssignRole:createAuthEndpoint("/iam/users/:id/role",{method:"POST",use,body:z.object({role:slug,confirmation:z.string().max(100).optional()}).strict()},async ctx=>{
    check(ctx.context.principal,"iam:users:manage-roles");return response(await changeAccess(config.connectionString,{kind:"user",id:ctx.params.id,actor:ctx.context.principal.id,...ctx.body},config.defaultRole,config.adminRole));
   }),
  },
 } satisfies BetterAuthPlugin;
}
`;
