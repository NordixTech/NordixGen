import { z } from "zod";

const IdentifierSchema = z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/);
const SlugSchema = z.string().regex(/^[a-z][a-z0-9-]*$/);
const PathSchema = z
  .string()
  .min(1)
  .refine((value) => !value.includes("\\"), {
    message: "Use forward slashes in paths.",
  });

const CommonFieldProperties = {
  description: z.string().optional(),
  required: z.boolean().default(true),
  unique: z.boolean().default(false),
  default: z.unknown().optional(),
};

export const FieldSchema = z.discriminatedUnion("type", [
  z
    .object({
      ...CommonFieldProperties,
      type: z.literal("string"),
      minLength: z.number().int().nonnegative().optional(),
      maxLength: z.number().int().positive().optional(),
    })
    .strict(),
  z
    .object({
      ...CommonFieldProperties,
      type: z.literal("number"),
      format: z.enum(["integer", "float", "decimal"]).optional(),
      precision: z.number().int().positive().optional(),
      scale: z.number().int().nonnegative().optional(),
    })
    .strict(),
  z.object({ ...CommonFieldProperties, type: z.literal("boolean") }).strict(),
  z.object({ ...CommonFieldProperties, type: z.literal("date") }).strict(),
  z.object({ ...CommonFieldProperties, type: z.literal("uuid") }).strict(),
  z.object({ ...CommonFieldProperties, type: z.literal("json") }).strict(),
  z
    .object({
      ...CommonFieldProperties,
      type: z.literal("enum"),
      enumName: IdentifierSchema,
    })
    .strict(),
]);

export const RelationSchema = z
  .object({
    type: z.enum(["many-to-one", "one-to-many", "one-to-one", "many-to-many"]),
    target: IdentifierSchema,
    foreignKey: IdentifierSchema.optional(),
    joinTable: IdentifierSchema.optional(),
    onDelete: z.enum(["cascade", "set-null", "restrict", "no-action"]).default("no-action"),
    required: z.boolean().default(false),
    description: z.string().optional(),
  })
  .strict();

export const EntitySchema = z
  .object({
    description: z.string().optional(),
    fields: z.record(IdentifierSchema, FieldSchema).default({}),
    relations: z.record(IdentifierSchema, RelationSchema).default({}),
    timestamps: z.boolean().default(false),
    softDelete: z.boolean().default(false),
  })
  .strict();

const StateManagementObjectSchema = z
  .object({
    client: z.enum(["zustand", "context", "none"]).default("zustand"),
    server: z.enum(["tanstack-query", "swr", "native-fetch"]).default("tanstack-query"),
    generateHooks: z.boolean().default(true),
    optimisticUpdates: z.boolean().default(false),
  })
  .strict();

export const FrontendSchema = z
  .object({
    name: SlugSchema,
    framework: z.string().min(1),
    type: z.enum(["web", "mobile", "desktop"]).default("web"),
    styling: z.string().min(1).optional(),
    stateManagement: z.union([z.string().min(1), StateManagementObjectSchema]).optional(),
    connectsTo: SlugSchema.optional(),
    authUI: z.boolean().default(false),
    path: PathSchema,
  })
  .strict();

const AuthenticatedAuthSchema = z
  .object({
    type: z.enum(["jwt", "pin", "oauth"]),
    providers: z
      .array(z.enum(["credentials", "google", "github"]).or(z.string().min(1)))
      .default([]),
    twoFactor: z.boolean().default(false),
    passwordRecovery: z.boolean().default(false),
    roles: z.array(SlugSchema).default([]),
    permissions: z.array(z.string().min(1)).default([]),
  })
  .strict();

export const AuthSchema = z.discriminatedUnion("type", [
  AuthenticatedAuthSchema,
  z.object({ type: z.literal("none") }).strict(),
]);

export const BackendSchema = z
  .object({
    name: SlugSchema,
    framework: z.string().min(1),
    architecture: z.enum(["clean", "modular"]).default("clean"),
    path: PathSchema,
    auth: AuthSchema.default({ type: "none" }),
  })
  .strict();

const ParameterSchema = z
  .object({
    name: IdentifierSchema,
    type: z.enum(["string", "number", "boolean", "date", "uuid", "json", "enum"]),
    required: z.boolean().default(true),
    enumName: IdentifierSchema.optional(),
  })
  .strict();

export const EndpointSchema = z
  .object({
    path: z.string().startsWith("/"),
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
    summary: z.string().optional(),
    entity: IdentifierSchema,
    authRequired: z.boolean().default(false),
    roles: z.array(SlugSchema).default([]),
    permissions: z.array(z.string().min(1)).default([]),
    queryParams: z.array(ParameterSchema).default([]),
    pathParams: z.array(ParameterSchema).default([]),
    requestBody: z.record(IdentifierSchema, FieldSchema).optional(),
    joins: z
      .array(
        z
          .object({
            entity: IdentifierSchema,
            type: z.enum(["inner", "left"]),
            fields: z.array(IdentifierSchema).default([]),
          })
          .strict(),
      )
      .default([]),
  })
  .strict();

const EnumValuesSchema = z
  .array(z.string().min(1))
  .min(1)
  .refine((values) => new Set(values).size === values.length, {
    message: "Enum values must be unique.",
  });

export const NordixConfigSchema = z
  .object({
    name: SlugSchema,
    version: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/),
    description: z.string().optional(),
    structure: z.enum(["monorepo", "single-app"]).default("monorepo"),
    frontend: FrontendSchema.omit({ name: true }).optional(),
    frontends: z.array(FrontendSchema).default([]),
    backend: BackendSchema.omit({ name: true }).optional(),
    backends: z.array(BackendSchema).default([]),
    database: z
      .object({
        engine: z.string().min(1),
        provider: z.string().min(1),
        orm: z.string().min(1),
      })
      .strict()
      .optional(),
    docker: z
      .object({
        postgres: z.boolean().default(false),
        mailpit: z.boolean().default(false),
        minio: z.boolean().default(false),
        redis: z.boolean().default(false),
      })
      .strict()
      .optional(),
    llm: z
      .object({
        enabled: z.boolean().default(false),
        exposeUseCases: z.boolean().default(false),
        endpoint: z.string().startsWith("/").optional(),
      })
      .strict()
      .optional(),
    deployment: z
      .object({
        provider: z.string().min(1),
        ci: z.string().min(1).optional(),
        iac: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
    enums: z.record(IdentifierSchema, EnumValuesSchema).default({}),
    entities: z.record(IdentifierSchema, EntitySchema).default({}),
    endpoints: z.array(EndpointSchema).default([]),
  })
  .strict()
  .superRefine((config, context) => {
    if (Object.keys(config.entities).length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["entities"],
        message: "At least one entity is required.",
      });
    }
  });

export type FieldDefinition = z.infer<typeof FieldSchema>;
export type RelationDefinition = z.infer<typeof RelationSchema>;
export type EntityDefinition = z.infer<typeof EntitySchema>;
export type FrontendDefinition = z.infer<typeof FrontendSchema>;
export type BackendDefinition = z.infer<typeof BackendSchema>;
export type EndpointDefinition = z.infer<typeof EndpointSchema>;
export type NordixConfig = z.infer<typeof NordixConfigSchema>;

export function normalizeFrontends(config: NordixConfig): FrontendDefinition[] {
  const frontends = [...config.frontends];
  if (config.frontend) {
    frontends.push({
      ...config.frontend,
      name: "frontend",
      type: config.frontend.type ?? "web",
      authUI: config.frontend.authUI ?? false,
    });
  }
  return frontends.sort((left, right) => left.name.localeCompare(right.name));
}

export function normalizeBackends(config: NordixConfig): BackendDefinition[] {
  const backends = [...config.backends];
  if (config.backend) {
    backends.push({
      ...config.backend,
      name: "backend",
      architecture: config.backend.architecture ?? "clean",
      auth: config.backend.auth ?? { type: "none" },
    });
  }
  return backends.sort((left, right) => left.name.localeCompare(right.name));
}
