import type {
  BackendDefinition,
  EndpointDefinition,
  EntityDefinition,
  FieldDefinition,
  FrontendDefinition,
  NordixConfig,
  PaginationDefinition,
  RelationDefinition,
} from "../configuration/schema.js";
import type { ConfigDiagnostic } from "../diagnostics.js";

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };
export const APPLICATION_ERROR_KINDS = [
  "validation",
  "unauthorized",
  "forbidden",
  "not_found",
  "conflict",
  "unexpected",
] as const;

export interface ConfigurationOrigin {
  readonly path: string;
  readonly source?: Readonly<NonNullable<ConfigDiagnostic["source"]>>;
}
export type LocateConfiguration = (path: string) => ConfigDiagnostic["source"];

/** Concrete TypeScript/JSON value mapping, independent of Hono and Drizzle. */
export interface ResolvedValue {
  readonly kind: FieldDefinition["type"];
  readonly applicationType: string;
  readonly transportType: string;
  readonly enumValues?: readonly string[];
  readonly serialization: "identity" | "utc-iso-instant" | "json";
}
export type ResolvedField = Readonly<FieldDefinition> & {
  readonly name: string;
  readonly column: string;
  readonly origin: ConfigurationOrigin;
  readonly generated: false | "identity" | "created-at" | "updated-at" | "soft-delete";
  readonly nullable: boolean;
  readonly value: ResolvedValue;
  readonly defaultValue:
    | { readonly kind: "absent" }
    | { readonly kind: "clock" }
    | { readonly kind: "literal"; readonly value: JsonValue };
  readonly writable: boolean;
  readonly createOptional: boolean;
};
export type ResolvedRelation = Readonly<RelationDefinition> & {
  readonly name: string;
  readonly targetId: string;
  readonly ownerId: string;
  readonly foreignKey?: string;
  readonly foreignKeyEntity?: string;
  readonly joinTable?: string;
  readonly onDelete: NonNullable<RelationDefinition["onDelete"]>;
  readonly cardinality: "one" | "many";
  readonly origin: ConfigurationOrigin;
};
export interface ResolvedEntity {
  readonly id: string;
  readonly name: string;
  readonly backend: string;
  readonly moduleId: string;
  readonly table: string;
  readonly page: string;
  readonly description?: string;
  readonly fields: Readonly<Record<string, ResolvedField>>;
  readonly relations: Readonly<Record<string, ResolvedRelation>>;
  readonly timestamps: Readonly<EntityDefinition["timestamps"]>;
  readonly softDelete: EntityDefinition["softDelete"];
  readonly generatedFields: readonly string[];
  readonly writableFields: readonly string[];
  readonly origin: ConfigurationOrigin;
}
export interface FieldBinding {
  readonly entityId: string;
  readonly entity: string;
  readonly field: string;
  readonly column: string;
}
export interface ResolvedInput {
  readonly name: string;
  readonly from: "path" | "query" | "body" | "pagination";
  readonly definition: ResolvedField;
  readonly optional: boolean;
  readonly nullable: boolean;
  readonly array: boolean;
  readonly binding?: FieldBinding;
  readonly origin: ConfigurationOrigin;
}
export type ResolvedParameter = Readonly<
  Omit<EndpointDefinition["queryParams"][number], "field">
> & {
  readonly field?: Readonly<{ entity: string; field: string }>;
  readonly definition: ResolvedField;
  readonly input: ResolvedInput;
};
export type ResolvedJoin = Readonly<Omit<EndpointDefinition["joins"][number], "fields">> & {
  readonly fields: readonly string[];
  readonly relation: ResolvedRelation;
  readonly projection: Readonly<Record<string, ResolvedField>>;
  readonly cardinality: "one" | "many";
  readonly nullable: boolean;
};
export interface ResolvedResponse {
  readonly kind: "rows" | "page";
  readonly entity: Readonly<Record<string, ResolvedField>>;
  readonly joins: readonly ResolvedJoin[];
  readonly status: 200;
}
export interface ResolvedAccess {
  readonly authority?: string;
  readonly authenticated: boolean;
  readonly roles: readonly string[];
  readonly permissions: readonly string[];
}
export interface ApplicationValue {
  readonly value: ResolvedValue;
  readonly nullable: boolean;
  readonly optional: boolean;
  readonly array: boolean;
}
export interface PublicApplicationContract {
  readonly id: string;
  readonly name: string;
  readonly input: Readonly<Record<string, ApplicationValue>>;
  readonly output: {
    readonly kind: "rows" | "page";
    readonly entity: Readonly<Record<string, ApplicationValue>>;
    readonly joins: Readonly<
      Record<
        string,
        {
          readonly cardinality: "one" | "many";
          readonly nullable: boolean;
          readonly fields: Readonly<Record<string, ApplicationValue>>;
        }
      >
    >;
  };
  readonly access: ResolvedAccess;
  readonly context: { readonly kind: "trusted-backend-context"; readonly backend: string };
  readonly errors: typeof APPLICATION_ERROR_KINDS;
}
export type ResolvedOperation = Readonly<
  Omit<
    EndpointDefinition,
    | "authRequired"
    | "pagination"
    | "pathParams"
    | "queryParams"
    | "joins"
    | "requestBody"
    | "roles"
    | "permissions"
  >
> & {
  readonly roles: readonly string[];
  readonly permissions: readonly string[];
  readonly id: string;
  readonly moduleId: string;
  readonly entityId: string;
  readonly typeName: string;
  readonly action: "query" | "custom" | "create" | "update" | "delete";
  readonly authRequired: boolean;
  readonly access: ResolvedAccess;
  readonly pathParams: readonly ResolvedParameter[];
  readonly queryParams: readonly ResolvedParameter[];
  readonly joins: readonly ResolvedJoin[];
  readonly pagination?: Readonly<PaginationDefinition> & {
    readonly profile: string;
    readonly origin: ConfigurationOrigin;
  };
  readonly body: {
    readonly kind: "none" | "inline" | "create" | "update";
    readonly fields: Readonly<Record<string, ResolvedInput>>;
    readonly dynamicDefaults: readonly string[];
    readonly serverDefaults: readonly string[];
    readonly writeFields: readonly string[];
  };
  readonly input: Readonly<Record<string, ResolvedInput>>;
  readonly response: ResolvedResponse;
  readonly application: PublicApplicationContract;
  readonly origin: ConfigurationOrigin;
};
export interface ResolvedModule {
  readonly id: string;
  readonly name: string;
  readonly backend: string;
  readonly architecture: BackendDefinition["modules"][string]["architecture"];
  readonly entities: readonly string[];
  readonly operations: readonly string[];
  readonly exports: readonly string[];
  readonly imports: readonly {
    readonly moduleId: string;
    readonly operations: readonly string[];
  }[];
  readonly dependencies: readonly string[];
  readonly origin: ConfigurationOrigin;
  readonly architectureOrigin: ConfigurationOrigin;
}
export interface ResolvedDatabase {
  readonly name: string;
  readonly engine: "postgres";
  readonly provider: "neon";
  /** Exclusive owning backend; absent for an unused declared resource. */
  readonly backend?: string;
}
export interface ResolvedIdentity {
  readonly passwordPolicy?: import("./account-policy.js").PasswordPolicy;
  readonly session?: { readonly expiresIn: string | number; readonly updateAge: string | number };
  readonly allowedEmailDomains?: readonly string[];
  readonly rateLimit?: {
    readonly enabled: boolean;
    readonly window: string | number;
    readonly max: number;
  };
  readonly permissions: readonly string[];
  readonly backend: string;
  readonly methods: readonly string[];
  readonly identityProviders: readonly string[];
  readonly features: readonly string[];
  readonly roles: readonly string[];
  readonly adminRole: string;
  readonly defaultRole: string;
  readonly rolePermissions: Readonly<Record<string, readonly string[]>>;
}
export interface ResolvedBackend {
  readonly storage: readonly string[];
  readonly name: string;
  readonly repository: Readonly<NordixConfig["repositories"][number]>;
  readonly path: string;
  readonly database?: ResolvedDatabase;
  readonly identity?: ResolvedIdentity;
  readonly modules: readonly string[];
  readonly moduleOrder: readonly string[];
  readonly entityOrder: readonly string[];
  readonly operations: readonly string[];
  readonly origin: ConfigurationOrigin;
}
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type TransportField = DistributiveOmit<ResolvedField, "column" | "origin" | "value"> & {
  readonly value: Omit<ResolvedValue, "applicationType">;
};
export type TransportInput = Omit<ResolvedInput, "definition" | "binding" | "origin"> & {
  readonly definition: TransportField;
};
export type TransportParameter = Pick<
  ResolvedParameter,
  "name" | "required" | "type" | "enumName" | "operator" | "field"
> & {
  readonly definition: TransportField;
  readonly input: TransportInput;
};
export type TransportJoin = Pick<
  ResolvedJoin,
  "entity" | "type" | "fields" | "cardinality" | "nullable"
> & { readonly projection: Readonly<Record<string, TransportField>> };
export interface TransportOperation {
  readonly id: string;
  readonly moduleId: string;
  readonly operationId: string;
  readonly action: ResolvedOperation["action"];
  readonly recordIdParameter?: string;
  readonly invalidates: readonly string[];
  readonly backend: string;
  readonly entity: string;
  readonly method: EndpointDefinition["method"];
  readonly path: string;
  readonly summary?: string;
  readonly authRequired: boolean;
  readonly roles: readonly string[];
  readonly permissions: readonly string[];
  readonly pathParams: readonly TransportParameter[];
  readonly queryParams: readonly TransportParameter[];
  readonly joins: readonly TransportJoin[];
  readonly pagination?: PaginationDefinition;
  readonly body: {
    readonly kind: ResolvedOperation["body"]["kind"];
    readonly fields: Readonly<Record<string, TransportInput>>;
  };
  readonly input: Readonly<Record<string, TransportInput>>;
  readonly response: {
    readonly kind: ResolvedResponse["kind"];
    readonly entity: Readonly<Record<string, TransportField>>;
    readonly joins: readonly TransportJoin[];
    readonly status: 200;
  };
}
export interface ResolvedFrontend {
  readonly theme: import("./theme.js").ResolvedTheme;
  readonly name: string;
  readonly repository: Readonly<NordixConfig["repositories"][number]>;
  readonly path: string;
  readonly connections: readonly string[];
  readonly identity?: ResolvedIdentity;
  readonly access: {
    readonly mode: FrontendDefinition["access"]["mode"];
    readonly backend?: string;
    readonly publicRoutes?: readonly string[];
  };
  readonly pages: readonly { readonly path: string; readonly authenticated: boolean }[];
  readonly operations: readonly string[];
  readonly operationNames: Readonly<Record<string, string>>;
  readonly endpoints: readonly TransportOperation[];
  readonly features: Readonly<
    Record<
      string,
      {
        readonly list?: string;
        readonly get?: string;
        readonly create?: string;
        readonly update?: string;
        readonly delete?: string;
        readonly custom: readonly string[];
      }
    >
  >;
  /** Public transport value DTOs; no domain/repository/table objects. */
  readonly entities: Readonly<
    Record<
      string,
      {
        readonly fields: Readonly<Record<string, TransportField>>;
        readonly softDelete: EntityDefinition["softDelete"];
      }
    >
  >;
  readonly origin: ConfigurationOrigin;
}
export interface ResolvedProject {
  readonly iac?: NordixConfig["iac"];
  readonly formatVersion: 5;
  readonly project: {
    readonly name: string;
    readonly version: string;
    readonly description?: string;
  };
  readonly organizations: readonly Readonly<NordixConfig["organizations"][number]>[];
  readonly repositories: readonly Readonly<NordixConfig["repositories"][number]>[];
  readonly databases: Readonly<Record<string, ResolvedDatabase>>;
  readonly enums: Readonly<Record<string, readonly string[]>>;
  readonly enumSqlNames: Readonly<Record<string, string>>;
  readonly backends: Readonly<Record<string, ResolvedBackend>>;
  readonly modules: Readonly<Record<string, ResolvedModule>>;
  readonly entities: Readonly<Record<string, ResolvedEntity>>;
  readonly operations: Readonly<Record<string, ResolvedOperation>>;
  readonly frontends: Readonly<Record<string, ResolvedFrontend>>;
  readonly moduleOrder: readonly string[];
  readonly entityOrder: readonly string[];
  readonly entityDependencies: readonly {
    readonly dependency: string;
    readonly dependent: string;
    readonly relation: string;
  }[];
  readonly readiness: readonly ConfigDiagnostic[];
}
export interface BackendModelView {
  readonly backend: ResolvedBackend;
  readonly enums: ResolvedProject["enums"];
  readonly enumSqlNames: ResolvedProject["enumSqlNames"];
  readonly entities: ResolvedProject["entities"];
  readonly endpoints: readonly ResolvedOperation[];
  readonly entityOrder: readonly string[];
  readonly modules: readonly ResolvedModule[];
}
export interface ModuleModelView {
  readonly module: ResolvedModule;
  readonly entities: readonly ResolvedEntity[];
  readonly operations: readonly ResolvedOperation[];
  readonly exports: readonly PublicApplicationContract[];
  readonly imports: readonly {
    readonly moduleId: string;
    readonly operations: readonly PublicApplicationContract[];
  }[];
}
