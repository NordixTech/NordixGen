import type { ResolvedIdentity } from "../../project/types.js";
import type { BackendRenderContext, GeneratedFile } from "../contracts.js";
import { multipleRoleMutations } from "./multiple-role-mutations.js";
import { organizationFiles } from "./organizations.js";

export function scopedAuthorizationFiles(
  context: BackendRenderContext,
  original: readonly GeneratedFile[],
): readonly GeneratedFile[] {
  const identity = context.identity;
  if (!identity) throw Error("Authorization requires resolved identity.");
  const root = `${context.platformRoot}/authorization`;
  const enabled = identity.global.enabled;
  const multiple = identity.global.mode === "multiple";
  const organizations = identity.organizations.enabled;
  const files = original.filter((file) => enabled || !file.path.endsWith("/create-admin.ts"));
  const replace = (path: string, content: string) => {
    const index = files.findIndex((file) => file.path === path);
    if (index < 0) files.push({ path, content });
    else files[index] = { path, content };
  };
  if (!enabled) {
    replace(`${context.platformRoot}/database/schema/iam-schema.ts`, "export {};\n");
    replace(
      `${root}/seed.ts`,
      'import type {DrizzleDatabase} from "../database/drizzle-database.js";\nexport async function seedAuthorization(_db:DrizzleDatabase):Promise<void>{}\n',
    );
    replace(`${root}/mutations.ts`, "export {};\n");
  } else if (multiple) {
    const path = `${context.platformRoot}/database/schema/iam-schema.ts`;
    const schema = files.find((file) => file.path === path)?.content ?? "";
    replace(
      path,
      `${schema.replace(
        "pgTable,text,boolean,timestamp,unique",
        "pgTable,text,boolean,timestamp,unique,primaryKey",
      )}\nimport {authUser} from "./auth-schema.js";\nexport const authUserRoles=pgTable("auth_user_roles",{user_id:text("user_id").notNull().references(()=>authUser.id,{onDelete:"cascade"}),role_id:text("role_id").notNull().references(()=>authRoles.id,{onDelete:"cascade"})},table=>[primaryKey({columns:[table.user_id,table.role_id]})]);\n`,
    );
    replace(`${root}/mutations.ts`, multipleRoleMutations);
    replace(
      `${root}/create-admin.ts`,
      `import {resolve} from "node:path";import {pathToFileURL} from "node:url";import {sql} from "drizzle-orm";import {createDrizzleDatabase} from "../database/drizzle-database.js";import {seedAuthorization} from "./seed.js";
export async function createAdmin(email:string):Promise<void>{if(!email?.trim()||!process.env.DATABASE_URL)throw Error("Provide an existing email and DATABASE_URL.");const db=createDrizzleDatabase(process.env.DATABASE_URL);await seedAuthorization(db);const result=await db.execute(sql\`INSERT INTO auth_user_roles(user_id,role_id) SELECT id,\${${JSON.stringify(identity.adminRole)}} FROM auth_user WHERE email=\${email} ON CONFLICT(user_id,role_id) DO UPDATE SET role_id=EXCLUDED.role_id RETURNING user_id\`);if(result.rows.length!==1)throw Error("User not found. Register first.");}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)createAdmin(process.argv[2]).catch(()=>{console.error("Admin provisioning failed.");process.exitCode=1;});\n`,
    );
  }
  if (multiple || organizations || !enabled)
    replace(`${root}/repository.ts`, principalRepository(context));
  if (organizations) files.push(...organizationFiles(context));
  return files;
}

function principalRepository(context: BackendRenderContext): string {
  const identity = context.identity;
  if (!identity) throw Error("Identity required.");
  const global = identity.global.enabled;
  const multiple = identity.global.mode === "multiple";
  const organizations = identity.organizations.enabled;
  const globalQuery = global
    ? `LEFT JOIN LATERAL(SELECT coalesce(array_agg(DISTINCT r.id ORDER BY r.id),'{}') AS roles,coalesce(array_agg(DISTINCT p.permission ORDER BY p.permission) FILTER(WHERE p.permission IS NOT NULL),'{}') AS permissions FROM ${multiple ? "auth_user_roles ur JOIN auth_roles r ON r.id=ur.role_id" : "auth_roles r"} LEFT JOIN auth_role_permissions p ON p.role_id=r.id WHERE ${multiple ? "ur.user_id=u.id" : "r.id=u.role"}) g ON true`
    : "";
  const orgQuery = organizations
    ? `LEFT JOIN member m ON m.user_id=u.id AND m.organization_id=\${organizationId??null} AND m.active=true LEFT JOIN LATERAL(SELECT coalesce(array_agg(DISTINCT r.id ORDER BY r.id),'{}') AS roles,coalesce(array_agg(DISTINCT p.permission ORDER BY p.permission) FILTER(WHERE p.permission IS NOT NULL),'{}') AS permissions FROM ${identity.organizations.mode === "multiple" ? "auth_member_roles mr JOIN auth_org_roles r ON r.id=mr.role_id AND r.organization_id=m.organization_id" : "auth_org_roles r"} LEFT JOIN auth_org_role_permissions p ON p.org_role_id=r.id WHERE ${identity.organizations.mode === "multiple" ? "mr.member_id=m.id" : "r.id=m.role AND r.organization_id=m.organization_id"}) o ON true`
    : "";
  return `import {sql} from "drizzle-orm";import type {DrizzleDatabase} from "../database/drizzle-database.js";
export interface Role{id:string;name:string;description:string|null;isSystem:boolean;permissions:string[];}
export interface IamUser{id:string;name:string;email:string;role:string;roles:string[];}
export interface Principal{id:string;role:string;permissions:string[];globalRoles:string[];globalPermissions:string[];organizationId?:string;organizationRoles:string[];organizationPermissions:string[];}
export function createIamRepository(db:DrizzleDatabase){return {
async principal(id:string,organizationId?:string):Promise<Principal|undefined>{
 const result=await db.execute(sql\`SELECT u.id,${global ? "g.roles AS global_roles,g.permissions AS global_permissions" : "ARRAY[]::text[] AS global_roles,ARRAY[]::text[] AS global_permissions"}${organizations ? ",m.organization_id,o.roles AS organization_roles,o.permissions AS organization_permissions" : ""} FROM auth_user u ${globalQuery} ${orgQuery} WHERE u.id=\${id}\`);
 const row=result.rows[0];if(!row)return undefined;
 const globalRoles=(row.global_roles??[]) as string[],globalPermissions=(row.global_permissions??[]) as string[];
 return {id:String(row.id),role:globalRoles[0]??"",permissions:globalPermissions,globalRoles,globalPermissions,...(row.organization_id?{organizationId:String(row.organization_id)}:{}),organizationRoles:(row.organization_roles??[]) as string[],organizationPermissions:(row.organization_permissions??[]) as string[]};
},
async roles():Promise<Role[]>{${global ? `const result=await db.execute(sql\`SELECT r.id,r.name,r.description,r.is_system AS "isSystem",coalesce(array_agg(p.permission ORDER BY p.permission) FILTER(WHERE p.permission IS NOT NULL),'{}') AS permissions FROM auth_roles r LEFT JOIN auth_role_permissions p ON p.role_id=r.id GROUP BY r.id ORDER BY r.id\`);return result.rows as unknown as Role[];` : "return [];"}},
async users(limit:number,offset:number):Promise<{items:IamUser[];total:number}>{const result=await db.execute(sql\`SELECT u.id,u.name,u.email,${global ? (multiple ? "coalesce(array_agg(ur.role_id ORDER BY ur.role_id) FILTER(WHERE ur.role_id IS NOT NULL),'{}') AS roles" : "ARRAY[u.role] AS roles") : "ARRAY[]::text[] AS roles"} FROM auth_user u ${global && multiple ? "LEFT JOIN auth_user_roles ur ON ur.user_id=u.id" : ""} GROUP BY u.id ORDER BY u.id LIMIT \${limit} OFFSET \${offset}\`);const count=await db.execute(sql\`SELECT count(*)::int AS total FROM auth_user\`);return {items:result.rows.map(row=>({...row,role:(row.roles as string[])[0]??""})) as IamUser[],total:Number(count.rows[0]?.total??0)};}
};}export type IamRepository=ReturnType<typeof createIamRepository>;\n`;
}

export function scopedIamPlugin(identity: ResolvedIdentity, source: string): string {
  const organization = identity.organizations.enabled;
  const selected = organization
    ? 'ctx.headers?.get("x-organization-id")??(session.session as {activeOrganizationId?:string|null}).activeOrganizationId??undefined'
    : "undefined";
  if (!identity.global.enabled)
    return `import type {BetterAuthPlugin} from "better-auth";import {APIError,createAuthEndpoint,createAuthMiddleware,sessionMiddleware} from "better-auth/api";import {createIamRepository} from "../authorization/repository.js";import {createDrizzleDatabase} from "../database/drizzle-database.js";import type {AuditService} from "../audit/runtime.js";
export function nordixIamPlugin(config:{connectionString:string;defaultRole:string;adminRole:string;trustedOrigins:readonly string[];audit?:AuditService}){
const repository=createIamRepository(createDrizzleDatabase(config.connectionString));const member=createAuthMiddleware(async ctx=>{const session=ctx.context.session;if(!session)throw new APIError("UNAUTHORIZED",{message:"A verified session is required."});const principal=await repository.principal(session.user.id,${selected});if(!principal)throw new APIError("UNAUTHORIZED",{message:"Account unavailable."});ctx.setHeader("Cache-Control","no-store");return {principal};});const use=[sessionMiddleware,member];
return {id:"nordix-iam",endpoints:{iamGetMe:createAuthEndpoint("/iam/me",{method:"GET",use},async ctx=>ctx.json(ctx.context.principal)),iamBootstrap:createAuthEndpoint("/iam/bootstrap",{method:"GET",use},async ctx=>ctx.json({user:{...ctx.context.principal,name:ctx.context.session!.user.name,email:ctx.context.session!.user.email},session:{id:ctx.context.session!.session.id,activeOrganizationId:ctx.context.principal.organizationId??null}}))}} satisfies BetterAuthPlugin;
}\n`;
  let result = source.replace(
    "isAuthorized, permissions, type Permission",
    "isAuthorized, globalPermissionCatalog as permissions, type Permission",
  );
  result = result
    .replaceAll("permissions.includes(value as Permission)", "permissions.includes(value as never)")
    .replaceAll("[a-z0-9-]*", "[a-z0-9_-]*");
  if (organization)
    result = result.replace(
      "repository.principal(session.user.id)",
      `repository.principal(session.user.id,${selected})`,
    );
  result = result.replace(
    "id:user.id,name:user.name,email:user.email,role:ctx.context.principal.role,permissions:ctx.context.principal.permissions",
    "...ctx.context.principal,name:user.name,email:user.email",
  );
  if (identity.global.mode === "multiple")
    result = result
      .replace(/^\s*user:\{fields:.*\r?\n/m, "")
      .replace("role:slug,confirmation:", "roles:z.array(slug).min(1).max(100),confirmation:");
  return result;
}
