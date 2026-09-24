import type { NordixConfig } from '../schema/nordix.schema.js';
import type { IrEndpoint, IrEntity, IrField, IrUseCase, NordixIr } from './types.js';

export function toSnakeCase(str: string): string {
  return str
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[\s-]+/g, '_')
    .toLowerCase();
}

export function toCamelCase(str: string): string {
  if (!str) return '';
  return str
    .replace(/[-_\s]+([a-zA-Z0-9])/g, (_, g1) => g1.toUpperCase())
    .replace(/^[A-Z]/, (c) => c.toLowerCase());
}

export function toPascalCase(str: string): string {
  if (!str) return '';
  if (!str.includes('-') && !str.includes('_') && !str.includes(' ')) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }
  const camel = toCamelCase(str);
  return camel.charAt(0).toUpperCase() + camel.slice(1);
}

export function pluralize(str: string): string {
  if (str.endsWith('y') && !/[aeiou]y$/i.test(str)) {
    return `${str.slice(0, -1)}ies`;
  }
  if (
    str.endsWith('s') ||
    str.endsWith('x') ||
    str.endsWith('z') ||
    str.endsWith('ch') ||
    str.endsWith('sh')
  ) {
    return `${str}es`;
  }
  return `${str}s`;
}

/**
 * Topologically sorts entities using Kahn's algorithm so dependencies come first.
 */
export function topologicalSort(
  entityNames: string[],
  dependencyMap: Map<string, Set<string>>,
): string[] {
  const inDegree = new Map<string, number>();
  const adj = new Map<string, Set<string>>();

  for (const name of entityNames) {
    inDegree.set(name, 0);
    adj.set(name, new Set());
  }

  for (const [entity, deps] of dependencyMap.entries()) {
    for (const dep of deps) {
      const neighborSet = adj.get(dep);
      if (neighborSet) {
        neighborSet.add(entity);
        inDegree.set(entity, (inDegree.get(entity) || 0) + 1);
      }
    }
  }

  const queue: string[] = [];
  for (const [name, degree] of inDegree.entries()) {
    if (degree === 0) {
      queue.push(name);
    }
  }

  const sorted: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    sorted.push(current);

    const neighbors = adj.get(current) || new Set();
    for (const neighbor of neighbors) {
      const currentDegree = inDegree.get(neighbor) ?? 1;
      const newDegree = currentDegree - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) {
        queue.push(neighbor);
      }
    }
  }

  // If there is a cycle, append any remaining entities gracefully
  if (sorted.length < entityNames.length) {
    for (const name of entityNames) {
      if (!sorted.includes(name)) {
        sorted.push(name);
      }
    }
  }

  return sorted;
}

export function buildNordixIr(config: NordixConfig): NordixIr {
  const entities: Record<string, IrEntity> = {};
  const dependencyMap = new Map<string, Set<string>>();
  const entityNames = Object.keys(config.entities);

  // 1. Process base entities and fields
  for (const [rawName, entitySpec] of Object.entries(config.entities)) {
    const name = toPascalCase(rawName);
    const tableName = entitySpec.tableName || toSnakeCase(pluralize(name));

    const primaryKey: IrField = {
      name: 'id',
      columnName: 'id',
      type: 'uuid',
      required: true,
      unique: true,
      isPrimaryKey: true,
    };

    const fields: Record<string, IrField> = {
      id: primaryKey,
    };

    // User-defined fields
    for (const [fieldName, fieldSpec] of Object.entries(entitySpec.fields)) {
      if (fieldName === 'id') continue;
      fields[fieldName] = {
        name: fieldName,
        columnName: toSnakeCase(fieldName),
        type: fieldSpec.type,
        enumName: fieldSpec.enumName,
        required: fieldSpec.required,
        unique: fieldSpec.unique,
        default: fieldSpec.default,
        description: fieldSpec.description,
      };
    }

    // Timestamps
    if (entitySpec.timestamps) {
      fields.createdAt = {
        name: 'createdAt',
        columnName: 'created_at',
        type: 'date',
        required: true,
        unique: false,
        isSystemAudit: true,
      };
      fields.updatedAt = {
        name: 'updatedAt',
        columnName: 'updated_at',
        type: 'date',
        required: true,
        unique: false,
        isSystemAudit: true,
      };
    }

    // Soft delete
    if (entitySpec.softDelete) {
      fields.deletedAt = {
        name: 'deletedAt',
        columnName: 'deleted_at',
        type: 'date',
        required: false,
        unique: false,
        isSystemAudit: true,
      };
    }

    entities[name] = {
      name,
      tableName,
      description: entitySpec.description,
      primaryKey,
      fields,
      relations: {},
      softDelete: entitySpec.softDelete,
      timestamps: entitySpec.timestamps,
      dependencies: [],
    };

    dependencyMap.set(name, new Set());
  }

  // 2. Process relations and foreign key columns
  for (const [rawName, entitySpec] of Object.entries(config.entities)) {
    const sourceName = toPascalCase(rawName);
    const sourceEntity = entities[sourceName];
    if (!sourceEntity) continue;

    for (const [relName, relSpec] of Object.entries(entitySpec.relations)) {
      const targetName = toPascalCase(relSpec.target);
      const targetEntity = entities[targetName];
      if (!targetEntity) continue;

      const isSourceOwner = relSpec.type === 'many-to-one' || relSpec.type === 'one-to-one';
      const foreignKeyColumn =
        relSpec.foreignKey ||
        (isSourceOwner ? `${toSnakeCase(targetName)}_id` : `${toSnakeCase(sourceName)}_id`);

      sourceEntity.relations[relName] = {
        name: relName,
        type: relSpec.type,
        targetEntity: targetName,
        targetTable: targetEntity.tableName,
        foreignKeyColumn,
        targetKeyColumn: 'id',
        onDelete: relSpec.onDelete,
        isSourceOwner,
      };

      if (isSourceOwner) {
        // Track dependency for topological sort
        dependencyMap.get(sourceName)?.add(targetName);
        sourceEntity.dependencies.push(targetName);

        // Add foreign key field on source entity if not explicitly defined
        const fkFieldName = toCamelCase(foreignKeyColumn);
        if (!sourceEntity.fields[fkFieldName]) {
          sourceEntity.fields[fkFieldName] = {
            name: fkFieldName,
            columnName: foreignKeyColumn,
            type: 'uuid',
            required: relSpec.type === 'many-to-one',
            unique: relSpec.type === 'one-to-one',
          };
        }
      }
    }
  }

  // 3. Topological sorting
  const sortedEntityNames = topologicalSort(entityNames.map(toPascalCase), dependencyMap);

  // 4. Generate Use Cases and Endpoints
  const useCases: IrUseCase[] = [];
  const endpoints: IrEndpoint[] = [];

  for (const entityName of sortedEntityNames) {
    const entity = entities[entityName];
    if (!entity) continue;

    const plural = pluralize(entityName);
    const basePath = `/${toSnakeCase(plural)}`;

    // CRUD Use Cases
    const createUseCaseName = `Create${entityName}`;
    useCases.push({
      name: createUseCaseName,
      description: `Creates a new ${entityName} record.`,
      entityName,
      action: 'create',
      inputSchema: { ...entity.fields },
      outputSchema: { ...entity.fields },
      rolesRequired: ['admin'],
    });

    const getByIdUseCaseName = `Get${entityName}ById`;
    useCases.push({
      name: getByIdUseCaseName,
      description: `Retrieves a ${entityName} record by its primary key ID.`,
      entityName,
      action: 'read',
      inputSchema: { id: entity.primaryKey },
      outputSchema: { ...entity.fields },
      rolesRequired: [],
    });

    const listUseCaseName = `List${plural}`;
    useCases.push({
      name: listUseCaseName,
      description: `Lists ${plural} with pagination, filtering, and ordering.`,
      entityName,
      action: 'read',
      inputSchema: { page: 'number', limit: 'number' },
      outputSchema: { items: `Array<${entityName}>`, total: 'number' },
      rolesRequired: [],
    });

    const updateUseCaseName = `Update${entityName}`;
    useCases.push({
      name: updateUseCaseName,
      description: `Updates an existing ${entityName} record.`,
      entityName,
      action: 'update',
      inputSchema: { id: entity.primaryKey, ...entity.fields },
      outputSchema: { ...entity.fields },
      rolesRequired: ['admin'],
    });

    const deleteUseCaseName = `Delete${entityName}`;
    useCases.push({
      name: deleteUseCaseName,
      description: `Deletes a ${entityName} record (using ${entity.softDelete ? 'soft-delete' : 'hard-delete'}).`,
      entityName,
      action: 'delete',
      inputSchema: { id: entity.primaryKey },
      outputSchema: { success: 'boolean' },
      rolesRequired: ['admin'],
    });

    // Default CRUD Endpoints
    endpoints.push({
      path: basePath,
      method: 'GET',
      summary: `List all ${plural}`,
      entityName,
      useCaseName: listUseCaseName,
      authRequired: false,
      roles: [],
      queryParams: [
        { name: 'page', type: 'number', required: false },
        { name: 'limit', type: 'number', required: false },
      ],
      pathParams: [],
      joins: [],
    });

    endpoints.push({
      path: `${basePath}/:id`,
      method: 'GET',
      summary: `Get ${entityName} by ID`,
      entityName,
      useCaseName: getByIdUseCaseName,
      authRequired: false,
      roles: [],
      queryParams: [],
      pathParams: [{ name: 'id', type: 'uuid', required: true }],
      joins: [],
    });

    endpoints.push({
      path: basePath,
      method: 'POST',
      summary: `Create a new ${entityName}`,
      entityName,
      useCaseName: createUseCaseName,
      authRequired: true,
      roles: ['admin'],
      queryParams: [],
      pathParams: [],
      joins: [],
    });

    endpoints.push({
      path: `${basePath}/:id`,
      method: 'PUT',
      summary: `Update ${entityName} by ID`,
      entityName,
      useCaseName: updateUseCaseName,
      authRequired: true,
      roles: ['admin'],
      queryParams: [],
      pathParams: [{ name: 'id', type: 'uuid', required: true }],
      joins: [],
    });

    endpoints.push({
      path: `${basePath}/:id`,
      method: 'DELETE',
      summary: `Delete ${entityName} by ID`,
      entityName,
      useCaseName: deleteUseCaseName,
      authRequired: true,
      roles: ['admin'],
      queryParams: [],
      pathParams: [{ name: 'id', type: 'uuid', required: true }],
      joins: [],
    });
  }

  // 5. Merge custom endpoints defined in config
  for (const ep of config.endpoints) {
    const customUseCaseName = `Execute${ep.method}${toPascalCase(ep.path.replace(/[^a-zA-Z0-9]/g, ''))}`;
    useCases.push({
      name: customUseCaseName,
      description: ep.summary || `Custom endpoint ${ep.method} ${ep.path}`,
      entityName: ep.entity,
      action: 'custom',
      inputSchema: { queryParams: ep.queryParams, pathParams: ep.pathParams },
      outputSchema: {},
      rolesRequired: ep.roles,
    });

    endpoints.push({
      path: ep.path,
      method: ep.method,
      summary: ep.summary || `Custom ${ep.method} ${ep.path}`,
      entityName: ep.entity,
      useCaseName: customUseCaseName,
      authRequired: ep.authRequired,
      roles: ep.roles,
      queryParams: ep.queryParams,
      pathParams: ep.pathParams,
      joins: ep.joins,
    });
  }

  return {
    config,
    projectName: config.name,
    entities,
    sortedEntityNames,
    enums: config.enums,
    useCases,
    endpoints,
    hasAuth: config.backend.auth.type !== 'none',
    authRoles: config.backend.auth.roles,
  };
}
