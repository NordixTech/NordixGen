import type {
  DeletionPolicy,
  FieldType,
  HttpMethod,
  NordixConfig,
  RelationType,
} from '../schema/nordix.schema.js';

export interface IrField {
  name: string;
  columnName: string;
  type: FieldType;
  enumName?: string;
  required: boolean;
  unique: boolean;
  default?: unknown;
  description?: string;
  isPrimaryKey?: boolean;
  isSystemAudit?: boolean;
}

export interface IrRelation {
  name: string;
  type: RelationType;
  targetEntity: string;
  targetTable: string;
  foreignKeyColumn: string;
  targetKeyColumn: string;
  onDelete: DeletionPolicy;
  isSourceOwner: boolean;
}

export interface IrEntity {
  name: string;
  tableName: string;
  description?: string;
  primaryKey: IrField;
  fields: Record<string, IrField>;
  relations: Record<string, IrRelation>;
  softDelete: boolean;
  timestamps: boolean;
  dependencies: string[]; // List of entity names this entity depends on (for FKs)
}

export interface IrUseCase {
  name: string;
  description: string;
  entityName?: string;
  action: 'create' | 'read' | 'update' | 'delete' | 'custom';
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  rolesRequired: string[];
}

export interface IrEndpoint {
  path: string;
  method: HttpMethod;
  summary: string;
  entityName?: string;
  useCaseName: string;
  authRequired: boolean;
  roles: string[];
  queryParams: Array<{ name: string; type: string; required: boolean }>;
  pathParams: Array<{ name: string; type: string; required: boolean }>;
  joins: Array<{ entity: string; type: 'inner' | 'left'; fields: string[] }>;
}

export interface NordixIr {
  config: NordixConfig;
  projectName: string;
  entities: Record<string, IrEntity>;
  sortedEntityNames: string[]; // Topologically sorted for migrations and seeders
  enums: Record<string, string[]>;
  useCases: IrUseCase[];
  endpoints: IrEndpoint[];
  hasAuth: boolean;
  authRoles: string[];
}
