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

export const SoftDeleteSchema = z.union([z.literal(false), z.enum(["boolean", "timestamp"])]);

export const EntitySchema = z
  .object({
    backend: SlugSchema,
    description: z.string().optional(),
    fields: z.record(IdentifierSchema, FieldSchema).default({}),
    relations: z.record(IdentifierSchema, RelationSchema).default({}),
    timestamps: z
      .object({
        createdAt: z.boolean().default(false),
        updatedAt: z.boolean().default(false),
      })
      .strict()
      .default({}),
    softDelete: SoftDeleteSchema.default(false),
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
    repository: SlugSchema,
    connectsTo: z.array(SlugSchema).default([]),
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
    repository: SlugSchema,
    path: PathSchema,
    auth: AuthSchema.default({ type: "none" }),
    persistence: z
      .object({
        database: SlugSchema,
        orm: SlugSchema,
      })
      .strict()
      .optional(),
  })
  .strict();

export const DatabaseSchema = z
  .object({
    engine: SlugSchema,
    provider: SlugSchema,
  })
  .strict();

export const EntityFieldReferenceSchema = z
  .object({
    entity: IdentifierSchema,
    field: IdentifierSchema,
  })
  .strict();

const ParameterShapeSchema = z
  .object({
    name: IdentifierSchema,
    type: z.enum(["string", "number", "boolean", "date", "uuid", "json", "enum"]).optional(),
    field: EntityFieldReferenceSchema.optional(),
    required: z.boolean().default(true),
    enumName: IdentifierSchema.optional(),
    operator: z.enum(["eq", "ne", "in", "gt", "gte", "lt", "lte", "contains"]).optional(),
  })
  .strict();

const ParameterSchema = ParameterShapeSchema.refine(
  (parameter) => parameter.type !== undefined || parameter.field !== undefined,
  {
    message: "A parameter must declare either a type or an entity field reference.",
  },
);

const PathParameterSchema = ParameterShapeSchema.extend({
  required: z.literal(true).default(true),
}).refine((parameter) => parameter.type !== undefined || parameter.field !== undefined, {
  message: "A parameter must declare either a type or an entity field reference.",
});

export const PaginationSchema = z
  .object({
    strategy: z.literal("offset").default("offset"),
    pageParam: IdentifierSchema.default("page"),
    pageSizeParam: IdentifierSchema.default("pageSize"),
    defaultPageSize: z.number().int().positive().default(25),
    maxPageSize: z.number().int().positive().default(100),
  })
  .strict();

const RequestBodySchema = z.union([
  z.record(
    IdentifierSchema,
    z.union([
      FieldSchema,
      z.object({ field: EntityFieldReferenceSchema, required: z.boolean().optional() }).strict(),
    ]),
  ),
  z
    .object({
      useCase: z
        .object({ entity: IdentifierSchema, operation: z.enum(["create", "update"]) })
        .strict(),
    })
    .strict(),
]);

export const EndpointSchema = z
  .object({
    backend: SlugSchema,
    path: z.string().startsWith("/"),
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
    operationId: IdentifierSchema.optional(),
    summary: z.string().optional(),
    entity: IdentifierSchema,
    authRequired: z.boolean().default(false),
    roles: z.array(SlugSchema).default([]),
    permissions: z.array(z.string().min(1)).default([]),
    queryParams: z.array(ParameterSchema).default([]),
    pathParams: z.array(PathParameterSchema).default([]),
    requestBody: RequestBodySchema.optional(),
    pagination: PaginationSchema.optional(),
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
  .strict()
  .superRefine((endpoint, context) => {
    const pathNames = [...endpoint.path.matchAll(/\{([^{}]+)\}/g)].map((match) => match[1] ?? "");
    if (/[{}]/.test(endpoint.path.replace(/\{[^{}]+\}/g, ""))) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["path"],
        message: "Path templates must use balanced `{parameter}` placeholders.",
      });
    }
    const parameterNames = endpoint.pathParams.map((parameter) => parameter.name);
    for (const name of new Set(pathNames)) {
      if (!parameterNames.includes(name)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["pathParams"],
          message: `Path placeholder "${name}" must have a matching path parameter.`,
        });
      }
    }
    for (const name of new Set(parameterNames)) {
      if (!pathNames.includes(name)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["pathParams"],
          message: `Path parameter "${name}" must match its corresponding path placeholder.`,
        });
      }
    }
    if (new Set(pathNames).size !== pathNames.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["path"],
        message: "Path parameter placeholders must be unique.",
      });
    }
    if (endpoint.pagination) {
      if (endpoint.pagination.defaultPageSize > endpoint.pagination.maxPageSize) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["pagination", "defaultPageSize"],
          message: "defaultPageSize cannot exceed maxPageSize.",
        });
      }
      if (endpoint.pagination.pageParam === endpoint.pagination.pageSizeParam) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["pagination", "pageSizeParam"],
          message: "Pagination parameter names must be different.",
        });
      }
    }
  });

const EnumValuesSchema = z
  .array(z.string().min(1))
  .min(1)
  .refine((values) => new Set(values).size === values.length, {
    message: "Enum values must be unique.",
  });

export const OrganizationSchema = z
  .object({
    name: SlugSchema,
    provider: z.enum(["github", "gitlab", "bitbucket"]),
    handle: z.string().min(1),
  })
  .strict();

export const RepositorySchema = z
  .object({
    name: SlugSchema,
    path: PathSchema,
    organization: SlugSchema.optional(),
    initializeGit: z.boolean().default(false),
    createRemote: z.boolean().default(false),
    visibility: z.enum(["private", "public"]).default("private"),
  })
  .strict();

export const NordixConfigSchema = z
  .object({
    name: SlugSchema,
    version: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/),
    description: z.string().optional(),
    organizations: z.array(OrganizationSchema).default([]),
    repositories: z.array(RepositorySchema).min(1),
    frontend: FrontendSchema.omit({ name: true }).optional(),
    frontends: z.array(FrontendSchema).default([]),
    backend: BackendSchema.omit({ name: true }).optional(),
    backends: z.array(BackendSchema).default([]),
    databases: z.record(SlugSchema, DatabaseSchema).default({}),
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
export type SoftDeleteStrategy = z.infer<typeof SoftDeleteSchema>;
export type FrontendDefinition = z.infer<typeof FrontendSchema>;
export type BackendDefinition = z.infer<typeof BackendSchema>;
export type EndpointDefinition = z.infer<typeof EndpointSchema>;
export type OrganizationDefinition = z.infer<typeof OrganizationSchema>;
export type RepositoryDefinition = z.infer<typeof RepositorySchema>;
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
