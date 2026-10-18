import type { BackendRenderContext, GeneratedFile } from "../contracts.js";
import { generateIamFiles } from "./iam.js";

export function generateAuthorizationFiles(
  context: BackendRenderContext,
): readonly GeneratedFile[] {
  const identity = context.identity;
  if (!identity) throw new Error("A resolved identity is required for authorization.");
  const root = `${context.platformRoot}/authorization`;
  const seeds = [...new Set([identity.adminRole, ...identity.roles])].sort().map((id) => ({
    id,
    name: id === identity.adminRole ? "Administrator" : id,
    isSystem: id === identity.adminRole || id === identity.defaultRole,
    permissions: id === identity.adminRole ? ["*"] : [...(identity.rolePermissions[id] ?? [])],
  }));
  return [
    {
      path: `${root}/policy.ts`,
      content: `export const permissions = ${JSON.stringify(identity.permissions)} as const;
export type Permission = (typeof permissions)[number];
export interface AuthorizationPrincipal { role?:string|null; permissions?:readonly string[]; }
export interface AuthorizationRequirements { permissions:readonly Permission[]; }
export function isAuthorized(principal:AuthorizationPrincipal,requirements:AuthorizationRequirements):boolean {
 const grants=principal.permissions??[];
 return requirements.permissions.every(permission=>permissions.includes(permission as Permission)&&(grants.includes(permission)||grants.includes("*")));
}
`,
    },
    {
      path: `${context.platformRoot}/database/schema/iam-schema.ts`,
      content: `import {pgTable,text,boolean,timestamp,primaryKey,jsonb,uuid} from "drizzle-orm/pg-core";
export const authRoles=pgTable("auth_roles",{
 id:text("id").primaryKey(),name:text("name").notNull(),description:text("description"),
 isSystem:boolean("is_system").notNull().default(false),
 createdAt:timestamp("created_at",{withTimezone:true,mode:"date"}).notNull().defaultNow(),
 updatedAt:timestamp("updated_at",{withTimezone:true,mode:"date"}).notNull().defaultNow(),
});
export const authIamAudit=pgTable("auth_iam_audit",{
 id:uuid("id").primaryKey().defaultRandom(),actorId:text("actor_id").notNull(),action:text("action").notNull(),targetId:text("target_id").notNull(),
 before:jsonb("before"),after:jsonb("after"),createdAt:timestamp("created_at",{withTimezone:true,mode:"date"}).notNull().defaultNow(),
});
export const authRolePermissions=pgTable("auth_role_permissions",{
 roleId:text("role_id").notNull().references(()=>authRoles.id,{onDelete:"cascade"}),
 permission:text("permission").notNull(),
},table=>[primaryKey({columns:[table.roleId,table.permission]})]);
`,
    },
    {
      path: `${root}/seed.ts`,
      content: `import {sql} from "drizzle-orm";
import type {DrizzleDatabase} from "../database/drizzle-database.js";
const initialRoles=${JSON.stringify(seeds)};
/** Atomic per role; existing role metadata/grants stay intact, except the admin wildcard invariant. */
export async function seedAuthorization(db:DrizzleDatabase):Promise<void> {
 for(const role of initialRoles){
  await db.execute(sql\`WITH inserted AS (
   INSERT INTO auth_roles (id,name,is_system) VALUES (\${role.id},\${role.name},\${role.isSystem})
   ON CONFLICT (id) DO NOTHING RETURNING id
  ) INSERT INTO auth_role_permissions (role_id,permission)
    SELECT inserted.id,g.value FROM inserted CROSS JOIN jsonb_array_elements_text(\${JSON.stringify(role.permissions)}::jsonb) AS g(value)
    ON CONFLICT (role_id,permission) DO NOTHING\`);
 }
 // The configured administrator's wildcard is a system invariant, even when its ID
 // already existed as an ordinary role before it was selected in YAML.
 await db.execute(sql\`INSERT INTO auth_role_permissions (role_id,permission) VALUES (\${${JSON.stringify(identity.adminRole)}},'*') ON CONFLICT (role_id,permission) DO NOTHING\`);
 const unsafe=await db.execute(sql\`SELECT permission FROM auth_role_permissions WHERE role_id=\${${JSON.stringify(identity.defaultRole)}} AND permission IN ('*','iam:roles:manage','iam:users:manage-roles')\`);
 if(unsafe.rows.length)throw new Error("The configured signup default role has IAM privileges. Choose a least-privilege default before starting the application.");
}
`,
    },
    {
      path: `${root}/create-admin.ts`,
      content: `import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {sql} from "drizzle-orm";
import {createDrizzleDatabase} from "../database/drizzle-database.js";
import {seedAuthorization} from "./seed.js";
/** Promote an existing, explicitly selected account. Never seed passwords or privileged signup. */
export async function createAdmin(email:string):Promise<void>{
 if(!email?.trim()||!process.env.DATABASE_URL)throw new Error("Provide an existing user email and DATABASE_URL.");
 const db=createDrizzleDatabase(process.env.DATABASE_URL);
 await seedAuthorization(db);
 const result=await db.execute(sql\`UPDATE auth_user SET role=\${${JSON.stringify(identity.adminRole)}},updated_at=now() WHERE email=\${email} RETURNING id\`);
 if(result.rows.length!==1)throw new Error("User not found. Register the account before promoting it.");
 console.log("Administrator role assigned.");
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){createAdmin(process.argv[2]).catch(()=>{console.error("Admin provisioning failed. Check the email, migrations and DATABASE_URL.");process.exitCode=1;});}
`,
    },
    ...generateIamFiles(context),
  ];
}
