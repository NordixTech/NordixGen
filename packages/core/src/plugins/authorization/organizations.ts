import type { BackendRenderContext, GeneratedFile } from "../contracts.js";
import { organizationPlugin } from "./organization-plugin.js";
import { organizationRuntime } from "./organization-runtime.js";

export function organizationFiles(context: BackendRenderContext): GeneratedFile[] {
  const policy = context.identity?.organizations;
  if (!policy?.enabled) return [];
  const root = context.platformRoot;
  return [
    {
      path: `${root}/database/schema/organization-schema.ts`,
      content: `import {pgTable,text,boolean,timestamp,unique,primaryKey,foreignKey,index} from "drizzle-orm/pg-core";import {authUser} from "./auth-schema.js";
export const organization=pgTable("organization",{id:text("id").primaryKey(),name:text("name").notNull(),slug:text("slug").notNull().unique(),logo:text("logo"),metadata:text("metadata"),createdAt:timestamp("created_at",{withTimezone:true,mode:"date"}).notNull().defaultNow()});
export const authOrgRoles=pgTable("auth_org_roles",{id:text("id").primaryKey(),organization_id:text("organization_id").notNull().references(()=>organization.id,{onDelete:"cascade"}),name:text("name").notNull(),description:text("description"),is_system:boolean("is_system").notNull().default(false),created_at:timestamp("created_at",{withTimezone:true,mode:"date"}).notNull().defaultNow(),updated_at:timestamp("updated_at",{withTimezone:true,mode:"date"}).notNull().defaultNow()},table=>[unique("auth_org_roles_organization_id_id").on(table.organization_id,table.id),unique("auth_org_roles_organization_name").on(table.organization_id,table.name)]);
export const authOrgRolePermissions=pgTable("auth_org_role_permissions",{id:text("id").primaryKey(),org_role_id:text("org_role_id").notNull().references(()=>authOrgRoles.id,{onDelete:"cascade"}),permission:text("permission").notNull()},table=>[unique("auth_org_role_permissions_unique").on(table.org_role_id,table.permission)]);
export const member=pgTable("member",{id:text("id").primaryKey(),organizationId:text("organization_id").notNull().references(()=>organization.id,{onDelete:"cascade"}),userId:text("user_id").notNull().references(()=>authUser.id,{onDelete:"cascade"}),role:text("role").notNull(),active:boolean("active").notNull().default(true),createdAt:timestamp("created_at",{withTimezone:true,mode:"date"}).notNull().defaultNow()},table=>[unique("member_organization_user").on(table.organizationId,table.userId),unique("member_organization_id_id").on(table.organizationId,table.id),index("member_user_id_idx").on(table.userId),foreignKey({columns:[table.organizationId,table.role],foreignColumns:[authOrgRoles.organization_id,authOrgRoles.id],name:"member_organization_role_fk"}).onDelete("restrict")]);
export const invitation=pgTable("invitation",{id:text("id").primaryKey(),organizationId:text("organization_id").notNull().references(()=>organization.id,{onDelete:"cascade"}),email:text("email").notNull(),role:text("role").notNull(),status:text("status").notNull().default("pending"),expiresAt:timestamp("expires_at",{withTimezone:true,mode:"date"}).notNull(),inviterId:text("inviter_id").notNull().references(()=>authUser.id,{onDelete:"cascade"}),createdAt:timestamp("created_at",{withTimezone:true,mode:"date"}).notNull().defaultNow(),tokenHash:text("token_hash").notNull().unique()},table=>[index("invitation_organization_idx").on(table.organizationId)]);
${policy.mode === "multiple" ? `export const authMemberRoles=pgTable("auth_member_roles",{member_id:text("member_id").notNull(),role_id:text("role_id").notNull(),organization_id:text("organization_id").notNull()},table=>[primaryKey({columns:[table.member_id,table.role_id]}),foreignKey({columns:[table.organization_id,table.member_id],foreignColumns:[member.organizationId,member.id],name:"auth_member_roles_member_fk"}).onDelete("cascade"),foreignKey({columns:[table.organization_id,table.role_id],foreignColumns:[authOrgRoles.organization_id,authOrgRoles.id],name:"auth_member_roles_role_fk"}).onDelete("cascade")]);` : "void primaryKey;"}
`,
    },
    {
      path: `${root}/authorization/organization-policy.ts`,
      content: `export const organizationPolicy:{enabled:boolean;mode:"single"|"multiple";roles:readonly string[];ownerRole:string;defaultRole:string;rolePermissions:Readonly<Record<string,readonly string[]>>}=${JSON.stringify(policy)};\n`,
    },
    {
      path: `${root}/authorization/organizations.ts`,
      content: organizationRuntime.replaceAll("__MULTIPLE__", String(policy.mode === "multiple")),
    },
    { path: `${root}/auth/nordix-organization-plugin.ts`, content: organizationPlugin },
  ];
}
