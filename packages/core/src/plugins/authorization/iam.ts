import type { BackendRenderContext, GeneratedFile } from "../contracts.js";
import { iamMutations } from "./iam-mutations.js";

export function generateIamFiles(context: BackendRenderContext): readonly GeneratedFile[] {
  const root = `${context.platformRoot}/authorization`;
  return [
    { path: `${root}/mutations.ts`, content: iamMutations },
    {
      path: `${root}/repository.ts`,
      content: `import {changeAccess,type AccessChange} from "./mutations.js";
import {sql} from "drizzle-orm";
import type {DrizzleDatabase} from "../database/drizzle-database.js";
const defaultRole=${JSON.stringify(context.identity?.defaultRole)};
const adminRole=${JSON.stringify(context.identity?.adminRole)};
export interface Role {id:string;name:string;description:string|null;isSystem:boolean;permissions:string[];}
export interface IamUser {id:string;name:string;email:string;role:string;}
export function createIamRepository(db:DrizzleDatabase){
 return {
 async principal(id:string){
  const result=await db.execute(sql\`SELECT u.id,u.role,COALESCE(json_agg(p.permission) FILTER (WHERE p.permission IS NOT NULL),'[]') AS permissions
   FROM auth_user u JOIN auth_roles r ON r.id=u.role LEFT JOIN auth_role_permissions p ON p.role_id=r.id WHERE u.id=\${id} GROUP BY u.id,u.role\`);
  return result.rows[0] as unknown as {id:string;role:string;permissions:string[]}|undefined;
 },
 async roles():Promise<Role[]>{const result=await db.execute(sql\`SELECT r.id,r.name,r.description,(r.is_system OR r.id IN (\${adminRole},\${defaultRole})) AS "isSystem",COALESCE(json_agg(p.permission ORDER BY p.permission) FILTER (WHERE p.permission IS NOT NULL),'[]') AS permissions FROM auth_roles r LEFT JOIN auth_role_permissions p ON p.role_id=r.id GROUP BY r.id ORDER BY r.id\`);return result.rows as unknown as Role[];},
 async users(limit:number,offset:number):Promise<{items:IamUser[];total:number}>{
  const result=await db.execute(sql\`SELECT id,name,email,role FROM auth_user ORDER BY id LIMIT \${limit} OFFSET \${offset}\`);
  const count=await db.execute(sql\`SELECT count(*)::int AS total FROM auth_user\`);
  return {items:result.rows as unknown as IamUser[],total:Number(count.rows[0]?.total??0)};
 },
 async create(role:{id:string;name:string;description?:string|null;permissions:string[]},actor:string):Promise<boolean>{
  const result=await db.execute(sql\`WITH inserted AS (INSERT INTO auth_roles(id,name,description) VALUES(\${role.id},\${role.name},\${role.description??null}) ON CONFLICT(id) DO NOTHING RETURNING id),
   grants AS (INSERT INTO auth_role_permissions(role_id,permission) SELECT inserted.id,g.value FROM inserted CROSS JOIN jsonb_array_elements_text(\${JSON.stringify(role.permissions)}::jsonb) AS g(value) RETURNING role_id),
   audit AS (INSERT INTO auth_iam_audit(actor_id,action,target_id,after) SELECT \${actor},'role.created',id,\${JSON.stringify(role)}::jsonb FROM inserted RETURNING id)
   SELECT id FROM inserted\`);return result.rows.length>0;
 },
 async change(change:AccessChange){return changeAccess(db,change,defaultRole,adminRole);},
 async audit(){const result=await db.execute(sql\`SELECT id,actor_id AS "actorId",action,target_id AS "targetId",before,after,created_at AS "createdAt" FROM auth_iam_audit ORDER BY created_at DESC,id DESC LIMIT 50\`);return result.rows;},
 async delete(id:string,actor:string):Promise<boolean>{
  const result=await db.execute(sql\`WITH removed AS (DELETE FROM auth_roles WHERE id=\${id} AND id NOT IN (\${adminRole},\${defaultRole}) AND is_system=false AND NOT EXISTS(SELECT 1 FROM auth_user WHERE role=\${id}) RETURNING id,name,description), audit AS (INSERT INTO auth_iam_audit(actor_id,action,target_id,before) SELECT \${actor},'role.deleted',id,to_jsonb(removed) FROM removed RETURNING id) SELECT id FROM removed\`);return result.rows.length>0;
 },

 };
}
export type IamRepository=ReturnType<typeof createIamRepository>;
`,
    },
    {
      path: `${root}/routes.ts`,
      content: `import {Hono} from "hono";
import {z} from "zod";
import {permissions,isAuthorized,type Permission} from "./policy.js";
import type {IamRepository} from "./repository.js";
import {problemResponse} from "../http/problem-details.js";
import {isTrustedAuthOrigin,type AuthEnvironment} from "../auth/auth.js";
const defaultRole=${JSON.stringify(context.identity?.defaultRole)};
const adminRole=${JSON.stringify(context.identity?.adminRole)};
const slug=z.string().regex(/^[a-z][a-z0-9-]*$/).max(100);
const grants=z.array(z.string()).max(500).refine(values=>new Set(values).size===values.length&&values.every(value=>value==="*"||permissions.includes(value as (typeof permissions)[number])),"Unknown or duplicate permission.");
const body=z.object({name:z.string().trim().min(1).max(200),description:z.string().max(2000).nullable().optional(),permissions:grants}).strict();
const creation=body.extend({id:slug});
export function createIamRoutes(repository:IamRepository,verify:(headers:Headers)=>Promise<{id:string}|null>){
 const app=new Hono<{Bindings:AuthEnvironment;Variables:{principal:{id:string;role:string;permissions:string[]}}}>().basePath("/api/iam");
 app.onError((_error,c)=>problemResponse(c,500,"Internal Server Error","Administration is temporarily unavailable."));
 app.use("*",async(c,next)=>{
  c.header("Cache-Control","no-store");
  const session=await verify(c.req.raw.headers);
  if(!session)return problemResponse(c,401,"Unauthorized","A verified session is required.");
  const principal=await repository.principal(session.id);
  if(!principal)return problemResponse(c,403,"Forbidden","The account has no active role.");
  c.set("principal",principal);
  if(["POST","PUT","DELETE"].includes(c.req.method)&&!isTrustedAuthOrigin(c.req.header("origin"),c.env))return problemResponse(c,403,"Forbidden","A trusted Origin header is required.");
  await next();
 });
 const allowed=(c:{get(key:"principal"):{permissions:string[]}},permission:Permission)=>isAuthorized(c.get("principal"),{permissions:[permission]});
 const denied=(c:Parameters<typeof problemResponse>[0])=>problemResponse(c,403,"Forbidden","Required IAM permission is missing.");
 app.get("/audit",async c=>allowed(c,"iam:roles:manage")?c.json(await repository.audit()):denied(c));
 app.get("/me",c=>c.json(c.get("principal")));
 app.get("/permissions",c=>allowed(c,"iam:roles:manage")?c.json(permissions):denied(c));
 app.get("/role-options",async c=>{
  if(!allowed(c,"iam:users:manage-roles"))return denied(c);
  return c.json((await repository.roles()).map(({id,name})=>({id,name})));
 });
 app.get("/roles",async c=>allowed(c,"iam:roles:manage")?c.json(await repository.roles()):denied(c));
 app.get("/users",async c=>{
  if(!allowed(c,"iam:users:manage-roles"))return denied(c);
  const pagination=z.object({page:z.coerce.number().int().min(1).max(100000).default(1),pageSize:z.coerce.number().int().min(1).max(100).default(25)}).strict().safeParse(c.req.query());
  if(!pagination.success)return problemResponse(c,400,"Validation Failed","Invalid pagination.");
  const {page,pageSize}=pagination.data;return c.json({...await repository.users(pageSize,(page-1)*pageSize),page,pageSize});
 });
 const changeResponse=(c:Parameters<typeof problemResponse>[0],result:Awaited<ReturnType<IamRepository["change"]>>)=>{
  if(result.code==="ok")return c.json({ok:true});
  const detail=result.code==="last_admin"?"Keep at least one user with both role management and user role assignment permissions. Assign another administrator first.":result.code==="confirmation_required"?"This change removes administrative access. Review its impact before continuing.":result.code==="forbidden"?"Your administrative access has changed. Refresh and try again.":result.code==="protected"?"Invalid permissions or protected system role.":"User or role does not exist.";
  const status=result.code==="not_found"?404:result.code==="forbidden"?403:result.code==="protected"?400:409;
  return c.json({title:"Access change",status,detail,...result},status);
 };
 const safeGrants=(id:string,values:string[])=>{
  if(id===defaultRole&&values.some(value=>value==="*"||value==="iam:roles:manage"||value==="iam:users:manage-roles"))return false;
  if(id===adminRole&&!values.includes("*"))return false;
  return true;
 };
 app.post("/roles",async c=>{
  if(!allowed(c,"iam:roles:manage"))return denied(c);
  const parsed=creation.safeParse(await c.req.json().catch(()=>null));
  if(!parsed.success||parsed.data.permissions.includes("*")||!safeGrants(parsed.data.id,parsed.data.permissions))return problemResponse(c,400,"Validation Failed","Provide a valid role and known concrete permissions.");
  return await repository.create(parsed.data,c.get("principal").id)?c.json({id:parsed.data.id},201):problemResponse(c,409,"Conflict","Role already exists.");
 });
 app.put("/roles/:id",async c=>{
  if(!allowed(c,"iam:roles:manage"))return denied(c);
  const id=c.req.param("id");const parsed=body.partial().extend({confirmation:z.string().max(100).optional()}).refine(value=>Object.keys(value).some(key=>key!=="confirmation")).safeParse(await c.req.json().catch(()=>null));
  if(!parsed.success)return problemResponse(c,400,"Validation Failed","Provide valid role metadata or permissions.");
  const existing=(await repository.roles()).find(role=>role.id===id);
  if(!existing)return problemResponse(c,404,"Not Found","Role does not exist.");
  const update={name:existing.name,description:existing.description,permissions:existing.permissions,...parsed.data};
  if(!safeGrants(id,update.permissions)||(id!==adminRole&&update.permissions.includes("*")&&!existing.permissions.includes("*")))return problemResponse(c,400,"Validation Failed","Invalid permissions or protected system role.");
  return changeResponse(c,await repository.change({kind:"role",id,actor:c.get("principal").id,...parsed.data}));
 });
 app.delete("/roles/:id",async c=>{
  if(!allowed(c,"iam:roles:manage"))return denied(c);
  return await repository.delete(c.req.param("id"),c.get("principal").id)?c.body(null,204):problemResponse(c,409,"Conflict","Role is missing, protected, or assigned to users.");
 });
 app.post("/users/:id/role",async c=>{
  if(!allowed(c,"iam:users:manage-roles"))return denied(c);
  const parsed=z.object({role:slug,confirmation:z.string().max(100).optional()}).strict().safeParse(await c.req.json().catch(()=>null));
  if(!parsed.success)return problemResponse(c,400,"Validation Failed","Provide a valid role.");
  return changeResponse(c,await repository.change({kind:"user",id:c.req.param("id"),actor:c.get("principal").id,...parsed.data}));
 });
 return app;
}
`,
    },
  ];
}
