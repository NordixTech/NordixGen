import { z } from "zod";
import { FrontendThemeSchema } from "./theme.js";

export const IdentifierSchema = z
  .string()
  .regex(
    /^[A-Za-z][A-Za-z0-9_]*$/,
    "Use an identifier starting with a letter, followed by letters, digits or underscores.",
  );
export const SlugSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]*$/, "Use lowercase letters, digits and hyphens, starting with a letter.");
const PermissionSchema = z
  .string()
  .regex(/^\S+$/, "Use one nonempty permission token without whitespace.");
const unique = <T extends z.ZodTypeAny>(schema: T) =>
  z.array(schema).superRefine((values, ctx) => {
    if (new Set(values).size !== values.length)
      ctx.addIssue({ code: "custom", message: "Remove duplicate values from this list." });
  });
const common = {
  description: z.string().optional(),
  required: z.boolean().default(true),
  unique: z.boolean().default(false),
  default: z.unknown().optional(),
};
export const FieldSchema = z.discriminatedUnion("type", [
  z
    .object({
      ...common,
      type: z.literal("string"),
      minLength: z.number().int().nonnegative().optional(),
      maxLength: z.number().int().positive().optional(),
    })
    .strict(),
  z
    .object({
      ...common,
      type: z.literal("number"),
      format: z.enum(["integer", "float", "decimal"]).optional(),
      precision: z.number().int().positive().optional(),
      scale: z.number().int().nonnegative().optional(),
    })
    .strict(),
  z.object({ ...common, type: z.literal("boolean") }).strict(),
  z.object({ ...common, type: z.literal("date") }).strict(),
  z.object({ ...common, type: z.literal("uuid") }).strict(),
  z.object({ ...common, type: z.literal("json") }).strict(),
  z.object({ ...common, type: z.literal("enum"), enumName: IdentifierSchema }).strict(),
]);
export const RelationSchema = z
  .object({
    type: z.enum(["many-to-one", "one-to-many", "one-to-one", "many-to-many"]),
    target: IdentifierSchema,
    foreignKey: IdentifierSchema.optional(),
    joinTable: IdentifierSchema.optional(),
    onDelete: z.enum(["cascade", "set-null", "restrict", "no-action"]).optional(),
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
      .object({ createdAt: z.boolean().default(false), updatedAt: z.boolean().default(false) })
      .strict()
      .default({}),
    softDelete: SoftDeleteSchema.default(false),
  })
  .strict();
export const ModuleSchema = z
  .object({
    architecture: z.enum(["clean", "hexagonal", "onion"]),
    entities: unique(IdentifierSchema).refine(
      (v) => v.length > 0,
      "Assign at least one entity to this module.",
    ),
    exports: unique(z.string().regex(/^[a-z][A-Za-z0-9]*$/)).default([]),
    imports: z
      .record(
        SlugSchema,
        unique(z.string().regex(/^[a-z][A-Za-z0-9]*$/)).refine(
          (v) => v.length > 0,
          "Name at least one exported operation.",
        ),
      )
      .default({}),
  })
  .strict();
export const AuthDurationSchema = z.union([
  z.number().int().positive().max(2147483647),
  z
    .string()
    .regex(/^[1-9]\d*[smhd]$/)
    .refine((value) => {
      const units: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
      return Number(value.slice(0, -1)) * units[value.slice(-1)] <= 2147483647;
    }, "Duration exceeds the supported limit."),
]);
export const PasswordPolicySchema = z
  .object({
    minLength: z.number().int().min(4).max(128).default(8),
    maxLength: z.number().int().min(4).max(128).default(128),
    numericOnly: z.boolean().default(false),
    requireUppercase: z.boolean().default(false),
    requireLowercase: z.boolean().default(false),
    requireNumber: z.boolean().default(false),
    requireSpecialChar: z.boolean().default(false),
  })
  .strict();
export const AuthenticationSchema = z
  .object({
    methods: unique(z.enum(["email-password", "username-password", "phone-number"]))
      .refine((v) => v.length > 0, "Enable at least one credential method.")
      .default(["email-password"]),
    identityProviders: unique(z.enum(["google", "github", "microsoft", "facebook"])).default([]),
    features: unique(z.enum(["email-verification", "password-recovery", "two-factor"])).default([]),
    passwordPolicy: PasswordPolicySchema.default({}),
    session: z
      .object({
        expiresIn: AuthDurationSchema.default("7d"),
        updateAge: AuthDurationSchema.default("1d"),
      })
      .strict()
      .default({}),
    allowedEmailDomains: unique(
      z
        .string()
        .toLowerCase()
        .regex(/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/),
    )
      .refine((domains) => domains.length > 0, "Declare at least one domain.")
      .optional(),
    rateLimit: z
      .object({
        enabled: z.boolean().default(true),
        window: AuthDurationSchema.default("60s"),
        max: z.number().int().positive().max(1000000).default(10),
        ip: z
          .object({
            window: AuthDurationSchema.default("60s"),
            max: z.number().int().positive().max(1000000).default(10),
          })
          .strict()
          .optional(),
        account: z
          .object({
            window: AuthDurationSchema.default("15m"),
            max: z.number().int().positive().max(1000000).default(10),
          })
          .strict()
          .default({}),
      })
      .strict()
      .default({}),
    smsOtp: z
      .object({
        dailyLimit: z.number().int().positive().max(1000000).default(10),
        cooldown: z
          .object({
            initialDelay: AuthDurationSchema.default("60s"),
            multiplier: z.number().min(1).max(10).default(2),
            maxDelay: AuthDurationSchema.default("15m"),
          })
          .strict()
          .default({}),
      })
      .strict()
      .default({}),
  })
  .strict();
export const AuthorizationSchema = z
  .object({
    roles: unique(SlugSchema).refine((v) => v.length > 0, "Declare at least one role."),
    adminRole: SlugSchema,
    defaultRole: SlugSchema,
    rolePermissions: z.record(SlugSchema, unique(PermissionSchema)).default({}),
  })
  .strict();
export const BackendSchema = z
  .object({
    name: SlugSchema,
    repository: SlugSchema,
    path: z.string().min(1),
    persistence: z.object({ database: SlugSchema }).strict().optional(),
    iac: z
      .object({ r2_storage: unique(IdentifierSchema).default([]) })
      .strict()
      .optional(),
    modules: z
      .record(SlugSchema, ModuleSchema)
      .refine((v) => Object.keys(v).length > 0, "Declare at least one business module."),
    authentication: AuthenticationSchema.optional(),
    authorization: AuthorizationSchema.optional(),
    ai: z
      .object({
        enabled: z.boolean().default(true),
        mcp: z
          .object({
            enabled: z.boolean().default(false),
            authMethods: unique(z.enum(["oauth", "api-key"]))
              .refine(
                (values) => values.length > 0,
                "Enable at least one MCP authentication method.",
              )
              .default(["oauth", "api-key"]),
          })
          .strict()
          .default({}),
        tools: z
          .object({ requireConfirmationOnMutations: z.boolean().default(true) })
          .strict()
          .default({}),
      })
      .strict()
      .optional(),
  })
  .strict();
export const FrontendAccessSchema = z
  .object({
    mode: z.enum(["public", "authenticated", "mixed"]).default("public"),
    backend: SlugSchema.optional(),
    publicRoutes: unique(z.string()).optional(),
  })
  .strict();
export const FrontendSchema = z
  .object({
    name: SlugSchema,
    repository: SlugSchema,
    path: z.string().min(1),
    connectsTo: unique(SlugSchema).default([]),
    access: FrontendAccessSchema.default({}),
    theme: FrontendThemeSchema.optional(),
    ai: z
      .object({
        enabled: z.boolean().default(true),
        backend: SlugSchema,
        chat: z
          .object({
            enabled: z.boolean().default(false),
            placement: z.enum(["floating", "page"]).default("floating"),
          })
          .strict()
          .default({}),
        connectPortal: z
          .object({ enabled: z.boolean().default(false) })
          .strict()
          .default({}),
      })
      .strict()
      .optional(),
  })
  .strict();
export const DatabaseSchema = z.object({}).strict();
export const EntityFieldReferenceSchema = z
  .object({ entity: IdentifierSchema, field: IdentifierSchema })
  .strict();
const parameter = {
  name: IdentifierSchema,
  type: z.enum(["string", "number", "boolean", "date", "uuid", "json", "enum"]).optional(),
  field: EntityFieldReferenceSchema.optional(),
  required: z.boolean().default(true),
  enumName: IdentifierSchema.optional(),
  operator: z.enum(["eq", "ne", "in", "gt", "gte", "lt", "lte", "contains"]).optional(),
};
const ParameterSchema = z.object(parameter).strict();
const PathParameterSchema = z
  .object({ ...parameter, required: z.literal(true).default(true) })
  .strict();
export const PaginationSchema = z
  .object({
    strategy: z.literal("offset").default("offset"),
    pageParam: IdentifierSchema.default("page"),
    pageSizeParam: IdentifierSchema.default("pageSize"),
    defaultPageSize: z.number().int().positive().default(25),
    maxPageSize: z.number().int().positive().default(100),
  })
  .strict();
export const PaginationProfileReferenceSchema = IdentifierSchema;
const RequestBodySchema = z.union([
  z
    .object({
      useCase: z
        .object({ entity: IdentifierSchema, operation: z.enum(["create", "update"]) })
        .strict(),
    })
    .strict(),
  z.record(
    z
      .string()
      .regex(
        /^(?!useCase$)[A-Za-z][A-Za-z0-9_]*$/,
        "useCase is reserved for the entity/operation body form. Rename this inline body property.",
      ),
    z.union([
      FieldSchema,
      z.object({ field: EntityFieldReferenceSchema, required: z.boolean().optional() }).strict(),
    ]),
  ),
]);
export const EndpointSchema = z
  .object({
    backend: SlugSchema,
    path: z.string().startsWith("/"),
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
    operationId: z
      .string()
      .regex(/^[a-z][A-Za-z0-9]*$/, "Name this operation with a lower-camel-case identifier."),
    summary: z.string().optional(),
    audit: z.boolean().optional(),
    entity: IdentifierSchema,
    authRequired: z.boolean().optional(),
    roles: unique(SlugSchema)
      .default([])
      .describe(
        "Deprecated for business endpoints: only an empty list is accepted. Declare required permissions instead.",
      ),
    permissions: unique(PermissionSchema).default([]),
    queryParams: z.array(ParameterSchema).default([]),
    pathParams: z.array(PathParameterSchema).default([]),
    requestBody: RequestBodySchema.optional(),
    pagination: PaginationProfileReferenceSchema.optional(),
    joins: z
      .array(
        z
          .object({
            entity: IdentifierSchema,
            type: z.enum(["inner", "left"]),
            fields: unique(IdentifierSchema).default([]),
          })
          .strict(),
      )
      .default([]),
  })
  .strict();
export const OrganizationSchema = z
  .object({ name: SlugSchema, handle: z.string().regex(/^[A-Za-z0-9-]+$/) })
  .strict();
export const RepositorySchema = z
  .object({
    name: SlugSchema,
    path: z.string().min(1),
    organization: SlugSchema.optional(),
    initializeGit: z.literal(true).default(true),
    createRemote: z.boolean().default(false),
    visibility: z.enum(["private", "public"]).default("private"),
  })
  .strict();
export const NordixConfigSchema = z
  .object({
    schemaVersion: z.literal(2),
    name: SlugSchema,
    version: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/),
    description: z.string().optional(),
    iac: z
      .object({
        repository: SlugSchema.optional(),
        cloudflare: z
          .object({
            r2_storage: z
              .record(
                IdentifierSchema,
                z.object({ visibility: z.enum(["private", "public"]).default("private") }).strict(),
              )
              .default({}),
          })
          .strict(),
      })
      .strict()
      .optional(),
    organizations: z.array(OrganizationSchema).default([]),
    repositories: z.array(RepositorySchema).min(1),
    databases: z.record(SlugSchema, DatabaseSchema).default({}),
    backends: z.array(BackendSchema).min(1),
    frontends: z.array(FrontendSchema).default([]),
    enums: z
      .record(
        IdentifierSchema,
        unique(z.string().min(1)).refine((v) => v.length > 0, "Declare at least one enum value."),
      )
      .default({}),
    entities: z
      .record(IdentifierSchema, EntitySchema)
      .refine((v) => Object.keys(v).length > 0, "Declare at least one entity."),
    pagination: z.record(IdentifierSchema, PaginationSchema).default({}),
    endpoints: z.array(EndpointSchema).default([]),
  })
  .strict();
export type FieldDefinition = z.infer<typeof FieldSchema>;
export type RelationDefinition = z.infer<typeof RelationSchema>;
export type EntityDefinition = z.infer<typeof EntitySchema>;
export type SoftDeleteStrategy = z.infer<typeof SoftDeleteSchema>;
export type PaginationDefinition = z.infer<typeof PaginationSchema>;
export type FrontendDefinition = z.infer<typeof FrontendSchema>;
export type BackendDefinition = z.infer<typeof BackendSchema>;
export type EndpointDefinition = z.infer<typeof EndpointSchema>;
export type OrganizationDefinition = z.infer<typeof OrganizationSchema>;
export type RepositoryDefinition = z.infer<typeof RepositorySchema>;
export type NordixConfig = z.infer<typeof NordixConfigSchema>;
export function effectiveAuthorization(backend: BackendDefinition) {
  return (
    backend.authorization ?? {
      roles: backend.authentication ? ["admin", "user"] : [],
      adminRole: backend.authentication ? "admin" : undefined,
      defaultRole: backend.authentication ? "user" : undefined,
      rolePermissions: {} as Record<string, string[]>,
    }
  );
}
