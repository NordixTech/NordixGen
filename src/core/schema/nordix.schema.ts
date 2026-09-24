import { z } from 'zod';

export const DeletionPolicySchema = z.enum(['cascade', 'soft-delete', 'restrict', 'set-null']);
export type DeletionPolicy = z.infer<typeof DeletionPolicySchema>;

export const FieldTypeSchema = z.enum([
  'string',
  'number',
  'boolean',
  'date',
  'uuid',
  'json',
  'enum',
]);
export type FieldType = z.infer<typeof FieldTypeSchema>;

export const EntityFieldSchema = z.object({
  type: FieldTypeSchema,
  enumName: z.string().optional(),
  required: z.boolean().default(true),
  unique: z.boolean().default(false),
  default: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
  description: z.string().optional(),
});
export type EntityField = z.infer<typeof EntityFieldSchema>;

export const RelationTypeSchema = z.enum([
  'one-to-one',
  'one-to-many',
  'many-to-one',
  'many-to-many',
]);
export type RelationType = z.infer<typeof RelationTypeSchema>;

export const EntityRelationSchema = z.object({
  type: RelationTypeSchema,
  target: z.string(),
  foreignKey: z.string().optional(),
  onDelete: DeletionPolicySchema.default('cascade'),
});
export type EntityRelation = z.infer<typeof EntityRelationSchema>;

export const EntitySchema = z.object({
  name: z.string().optional(),
  tableName: z.string().optional(),
  description: z.string().optional(),
  fields: z.record(EntityFieldSchema).default({}),
  relations: z.record(EntityRelationSchema).default({}),
  softDelete: z.boolean().default(true),
  timestamps: z.boolean().default(true),
});
export type Entity = z.infer<typeof EntitySchema>;

export const HttpMethodSchema = z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
export type HttpMethod = z.infer<typeof HttpMethodSchema>;

export const EndpointParamSchema = z.object({
  name: z.string(),
  type: z.enum(['string', 'number', 'boolean', 'uuid']),
  required: z.boolean().default(true),
  description: z.string().optional(),
});
export type EndpointParam = z.infer<typeof EndpointParamSchema>;

export const ComplexJoinSchema = z.object({
  entity: z.string(),
  type: z.enum(['inner', 'left']).default('left'),
  fields: z.array(z.string()).default([]),
});
export type ComplexJoin = z.infer<typeof ComplexJoinSchema>;

export const EndpointSchema = z.object({
  path: z.string().startsWith('/'),
  method: HttpMethodSchema,
  summary: z.string().optional(),
  entity: z.string().optional(),
  authRequired: z.boolean().default(false),
  roles: z.array(z.string()).default([]),
  queryParams: z.array(EndpointParamSchema).default([]),
  pathParams: z.array(EndpointParamSchema).default([]),
  joins: z.array(ComplexJoinSchema).default([]),
});
export type Endpoint = z.infer<typeof EndpointSchema>;

export const FrontendConfigSchema = z.object({
  framework: z.enum(['nextjs', 'angular', 'react-native', 'none']).default('nextjs'),
  type: z.enum(['web', 'pwa', 'mobile']).default('web'),
  styling: z.enum(['tailwind', 'css']).default('tailwind'),
  stateManagement: z.enum(['zustand', 'redux', 'none']).default('zustand'),
  authUI: z.boolean().default(true),
});
export type FrontendConfig = z.infer<typeof FrontendConfigSchema>;

export const AuthConfigSchema = z.object({
  type: z.enum(['jwt', 'session', 'none']).default('jwt'),
  providers: z.array(z.enum(['credentials', 'google', 'github'])).default(['credentials']),
  twoFactor: z.boolean().default(false),
  passwordRecovery: z.boolean().default(true),
  roles: z.array(z.string()).default(['admin', 'user']),
});
export type AuthConfig = z.infer<typeof AuthConfigSchema>;

export const BackendConfigSchema = z.object({
  framework: z.enum(['hono', 'nestjs', 'dotnet', 'django']).default('hono'),
  architecture: z.enum(['clean', 'hexagonal', 'modular']).default('clean'),
  auth: AuthConfigSchema.default({}),
});
export type BackendConfig = z.infer<typeof BackendConfigSchema>;

export const DatabaseConfigSchema = z.object({
  engine: z.enum(['postgres', 'mongodb', 'sqlite']).default('postgres'),
  provider: z.enum(['neon', 'cloudflare-d1', 'supabase', 'self-hosted']).default('neon'),
  orm: z.enum(['drizzle', 'prisma', 'efcore']).default('drizzle'),
});
export type DatabaseConfig = z.infer<typeof DatabaseConfigSchema>;

export const DockerLocalSchema = z.object({
  postgres: z.boolean().default(true),
  mailpit: z.boolean().default(true),
  minio: z.boolean().default(true),
  redis: z.boolean().default(false),
});
export type DockerLocal = z.infer<typeof DockerLocalSchema>;

export const LLMToolingConfigSchema = z.object({
  enabled: z.boolean().default(true),
  exposeUseCases: z.boolean().default(true),
  endpoint: z.string().default('/api/agent'),
});
export type LLMToolingConfig = z.infer<typeof LLMToolingConfigSchema>;

export const DeploymentConfigSchema = z.object({
  provider: z.enum(['cloudflare', 'vercel', 'vps', 'none']).default('cloudflare'),
  ci: z.enum(['github-actions', 'none']).default('github-actions'),
});
export type DeploymentConfig = z.infer<typeof DeploymentConfigSchema>;

export const NordixConfigSchema = z.object({
  name: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-_]+$/, {
      message:
        'Project name must contain only lowercase letters, numbers, hyphens, and underscores',
    }),
  version: z.string().default('0.1.0'),
  description: z.string().optional(),
  structure: z.enum(['monorepo', 'polyrepo']).default('monorepo'),
  frontend: FrontendConfigSchema.default({}),
  backend: BackendConfigSchema.default({}),
  database: DatabaseConfigSchema.default({}),
  docker: DockerLocalSchema.default({}),
  llm: LLMToolingConfigSchema.default({}),
  deployment: DeploymentConfigSchema.default({}),
  enums: z.record(z.array(z.string())).default({}),
  entities: z.record(EntitySchema).default({}),
  endpoints: z.array(EndpointSchema).default([]),
});

export type NordixConfig = z.infer<typeof NordixConfigSchema>;
