import type { BackendRenderContext, GeneratedFile } from "../contracts.js";
import { iamMutations } from "./iam-mutations.js";

export function generateIamFiles(context: BackendRenderContext): readonly GeneratedFile[] {
  const root = `${context.platformRoot}/authorization`;
  return [
    { path: `${root}/mutations.ts`, content: iamMutations },
    {
      path: `${root}/repository.ts`,
      content: `import {sql} from "drizzle-orm";
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

 };
}
export type IamRepository=ReturnType<typeof createIamRepository>;
`,
    },
  ];
}
