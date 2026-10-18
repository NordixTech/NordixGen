/** SQL batches keep the lock, impact assessment, write and audit in one transaction. */
export const iamMutations = `import {sql} from "drizzle-orm";
import type {DrizzleDatabase} from "../database/drizzle-database.js";
export interface AccessChange {kind:"role"|"user";id:string;actor:string;confirmation?:string;role?:string;name?:string;description?:string|null;permissions?:string[];}
export interface AccessResult {code:"ok"|"not_found"|"forbidden"|"protected"|"last_admin"|"confirmation_required";token:string;selfLoss:string[];lost:string[];affected:number;}
export async function changeAccess(db:DrizzleDatabase,change:AccessChange,defaultRole:string):Promise<AccessResult>{
 const input=JSON.stringify(change);
 const state=sql\`current_setting('nordix.iam_change')::jsonb\`;
 const ok=sql\`(\${state}->>'code')='ok'\`;
 const [,,decision]=await db.batch([
  db.execute(sql\`SET TRANSACTION ISOLATION LEVEL READ COMMITTED\`),
  // A separate statement is essential: snapshots after waiting see the preceding commit.
  db.execute(sql\`SELECT pg_advisory_xact_lock(197707,97)\`),
  db.execute(sql\`WITH input AS (SELECT \${input}::jsonb AS v),
   roles AS (SELECT r.id,r.name,r.description,COALESCE(array_agg(p.permission ORDER BY p.permission) FILTER(WHERE p.permission IS NOT NULL),ARRAY[]::text[]) grants FROM auth_roles r LEFT JOIN auth_role_permissions p ON p.role_id=r.id GROUP BY r.id),
   target AS (SELECT r.* FROM roles r,input i WHERE r.id=CASE WHEN i.v->>'kind'='role' THEN i.v->>'id' ELSE (SELECT role FROM auth_user WHERE id=i.v->>'id') END),
   proposed AS (SELECT t.*,CASE WHEN i.v->>'kind'='role' THEN CASE WHEN i.v ? 'permissions' THEN ARRAY(SELECT jsonb_array_elements_text(i.v->'permissions')) ELSE t.grants END ELSE COALESCE((SELECT grants FROM roles WHERE id=i.v->>'role'),ARRAY[]::text[]) END AS next FROM target t,input i),
   impact AS (SELECT p.*,a.id AS actor_id,a.role AS actor_role,
    ARRAY(SELECT capability FROM unnest(ARRAY['iam:roles:manage','iam:users:manage-roles']) capability WHERE (capability=ANY(p.grants) OR '*'=ANY(p.grants)) AND NOT(capability=ANY(p.next) OR '*'=ANY(p.next))) AS lost,
    (SELECT count(*)::int FROM auth_user u WHERE CASE WHEN i.v->>'kind'='role' THEN u.role=p.id ELSE u.id=i.v->>'id' END) AS affected,
    EXISTS(SELECT 1 FROM auth_user u JOIN roles r ON r.id=u.role WHERE NOT(CASE WHEN i.v->>'kind'='role' THEN u.role=p.id ELSE u.id=i.v->>'id' END) AND ('*'=ANY(r.grants) OR ARRAY['iam:roles:manage','iam:users:manage-roles']::text[] <@ r.grants)) OR ((SELECT count(*) FROM auth_user u WHERE CASE WHEN i.v->>'kind'='role' THEN u.role=p.id ELSE u.id=i.v->>'id' END)>0 AND ('*'=ANY(p.next) OR ARRAY['iam:roles:manage','iam:users:manage-roles']::text[] <@ p.next)) AS has_admin,
    EXISTS(SELECT 1 FROM roles r WHERE r.id=a.role AND ('*'=ANY(r.grants) OR (CASE WHEN i.v->>'kind'='role' THEN 'iam:roles:manage' ELSE 'iam:users:manage-roles' END)=ANY(r.grants))) AS authorized
    FROM proposed p,input i LEFT JOIN auth_user a ON a.id=i.v->>'actor'),
   assessment AS (SELECT i.v,p.*,
    CASE WHEN (i.v->>'kind'='role' AND p.actor_role=p.id) OR (i.v->>'kind'='user' AND i.v->>'id'=i.v->>'actor') THEN COALESCE(p.lost,ARRAY[]::text[]) ELSE ARRAY[]::text[] END AS self_loss,
    md5(jsonb_build_object('request',i.v-'confirmation','before',to_jsonb(p),'users',(SELECT COALESCE(jsonb_agg(jsonb_build_array(u.id,u.role) ORDER BY u.id),'[]'::jsonb) FROM auth_user u))::text) AS token
    FROM input i LEFT JOIN impact p ON true),
   decision AS (SELECT jsonb_build_object('code',CASE
    WHEN id IS NULL OR (v->>'kind'='user' AND NOT EXISTS(SELECT 1 FROM roles WHERE roles.id=v->>'role')) THEN 'not_found'
    WHEN NOT COALESCE(authorized,false) THEN 'forbidden'
    WHEN v->>'kind'='role' AND ((id=\${defaultRole} AND next && ARRAY['*','iam:roles:manage','iam:users:manage-roles']::text[]) OR (id='admin' AND NOT ('*'=ANY(next) OR ARRAY['iam:roles:manage','iam:users:manage-roles']::text[] <@ next)) OR ('*'=ANY(next) AND NOT '*'=ANY(grants))) THEN 'protected'
    WHEN NOT has_admin THEN 'last_admin'
    WHEN cardinality(lost)>0 AND affected>0 AND (v->>'confirmation') IS DISTINCT FROM token THEN 'confirmation_required'
    ELSE 'ok' END,'token',token,'selfLoss',self_loss,'lost',COALESCE(lost,ARRAY[]::text[]),'affected',COALESCE(affected,0),
    'before',CASE WHEN v->>'kind'='role' THEN jsonb_build_object('name',name,'description',description,'permissions',grants) ELSE jsonb_build_object('role',id) END,
    'after',CASE WHEN v->>'kind'='role' THEN jsonb_build_object('name',COALESCE(v->>'name',name),'description',CASE WHEN v ? 'description' THEN v->'description' ELSE to_jsonb(description) END,'permissions',next) ELSE jsonb_build_object('role',v->>'role') END) AS result FROM assessment)
   SELECT set_config('nordix.iam_change',result::text,true)::jsonb AS result FROM decision\`),
  db.execute(sql\`UPDATE auth_roles SET name=\${state}->'after'->>'name',description=\${state}->'after'->>'description',updated_at=now() WHERE \${change.kind}='role' AND id=\${change.id} AND \${ok}\`),
  db.execute(sql\`DELETE FROM auth_role_permissions WHERE \${change.kind}='role' AND role_id=\${change.id} AND \${ok}\`),
  db.execute(sql\`INSERT INTO auth_role_permissions(role_id,permission) SELECT \${change.id},g.value FROM jsonb_array_elements_text(\${state}->'after'->'permissions') g(value) WHERE \${change.kind}='role' AND \${ok}\`),
  db.execute(sql\`UPDATE auth_user SET role=\${change.role??null},updated_at=now() WHERE \${change.kind}='user' AND id=\${change.id} AND \${ok}\`),
  db.execute(sql\`INSERT INTO auth_iam_audit(actor_id,action,target_id,before,after) SELECT \${change.actor},\${change.kind==='role'?'role.updated':'user.role-assigned'},\${change.id},\${state}->'before',\${state}->'after' WHERE \${ok}\`)
 ]);
 const result=decision.rows[0]?.result as unknown as AccessResult;
 return {code:result.code,token:result.token,selfLoss:result.selfLoss,lost:result.lost,affected:result.affected};
}
`;
