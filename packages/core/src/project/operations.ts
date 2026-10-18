import type { EndpointDefinition, FieldDefinition, NordixConfig } from "../configuration/schema.js";
import { dictionary, resolveField, sortedRecord } from "./fields.js";
import { APPLICATION_ERROR_KINDS } from "./types.js";
import type {
  ConfigurationOrigin,
  FieldBinding,
  ResolvedBackend,
  ResolvedEntity,
  ResolvedField,
  ResolvedInput,
  ResolvedOperation,
} from "./types.js";

export function resolveOperation(
  endpoint: EndpointDefinition,
  index: number,
  config: NordixConfig,
  entities: Readonly<Record<string, ResolvedEntity>>,
  backend: ResolvedBackend,
  origin: (path: string) => ConfigurationOrigin,
): ResolvedOperation {
  const entity = entities[endpoint.entity];
  const path = `endpoints[${index}]`;
  const input: Record<string, ResolvedInput> = dictionary([]);
  const binding = (ref: { entity: string; field: string }): FieldBinding => ({
    ...ref,
    entityId: entities[ref.entity].id,
    column: entities[ref.entity].fields[ref.field].column,
  });
  const parameters = (group: "pathParams" | "queryParams") =>
    endpoint[group].map((parameter, pi) => {
      const at = origin(`${path}.${group}[${pi}]`);
      const source = parameter.field
        ? entities[parameter.field.entity].fields[parameter.field.field]
        : undefined;
      // Transport parameters inherit constraints, never stored defaults/nullability.
      const definition = resolveField(
        parameter.name,
        {
          ...(source ?? parameter),
          required: true,
          unique: false,
          default: undefined,
        } as FieldDefinition,
        config.enums,
        at,
      );
      const resolved: ResolvedInput = {
        name: parameter.name,
        from: group === "pathParams" ? "path" : "query",
        definition,
        optional: !parameter.required,
        nullable: false,
        array: parameter.operator === "in",
        ...(parameter.field ? { binding: binding(parameter.field) } : {}),
        origin: at,
      };
      input[parameter.name] = resolved;
      return {
        ...parameter,
        definition,
        input: resolved,
        ...(parameter.field && group === "queryParams"
          ? { operator: parameter.operator ?? ("eq" as const) }
          : {}),
      };
    });
  const pathParams = parameters("pathParams");
  const queryParams = parameters("queryParams");
  const reference =
    endpoint.requestBody && "useCase" in endpoint.requestBody
      ? (endpoint.requestBody.useCase as { entity: string; operation: "create" | "update" })
      : undefined;
  const bodyFields: Record<string, ResolvedInput> = dictionary([]);
  const addBody = (
    name: string,
    source: ResolvedField,
    optional: boolean,
    at: ConfigurationOrigin,
    target?: FieldBinding,
  ) => {
    const effective =
      reference?.operation === "update" || !optional
        ? { ...source, default: undefined, defaultValue: { kind: "absent" as const } }
        : source;
    // A caller argument referring to an ID/timestamp is not itself server-generated.
    const definition = {
      ...effective,
      name,
      origin: at,
      generated: false as const,
      writable: true,
      createOptional: optional,
    };
    const resolved: ResolvedInput = {
      name,
      from: "body",
      definition,
      optional,
      nullable: source.nullable,
      array: false,
      ...(target ? { binding: target } : {}),
      origin: at,
    };
    bodyFields[name] = resolved;
    input[name] = resolved;
  };
  if (reference) {
    for (const name of entity.writableFields)
      addBody(
        name,
        entity.fields[name],
        reference.operation === "update" || entity.fields[name].createOptional,
        origin(`${path}.requestBody.useCase`),
        binding({ entity: entity.name, field: name }),
      );
  } else if (endpoint.requestBody) {
    for (const [name, declaration] of Object.entries(endpoint.requestBody)) {
      const at = origin(`${path}.requestBody.${name}`);
      const source =
        "field" in declaration
          ? entities[declaration.field.entity].fields[declaration.field.field]
          : resolveField(name, declaration, config.enums, at);
      const optional =
        "field" in declaration && declaration.required !== undefined
          ? !declaration.required
          : !source.required || source.defaultValue.kind !== "absent";
      addBody(
        name,
        source,
        optional,
        at,
        "field" in declaration ? binding(declaration.field) : undefined,
      );
    }
  }
  const pagination = endpoint.pagination
    ? {
        ...config.pagination[endpoint.pagination],
        profile: endpoint.pagination,
        origin: origin(`pagination.${endpoint.pagination}`),
      }
    : undefined;
  if (pagination) {
    for (const [name, defaultValue] of [
      [pagination.pageParam, 1],
      [pagination.pageSizeParam, pagination.defaultPageSize],
    ] as const) {
      const at = origin(`${path}.pagination`);
      input[name] = {
        name,
        from: "pagination",
        definition: resolveField(
          name,
          {
            type: "number",
            format: "integer",
            required: true,
            unique: false,
            default: defaultValue,
          },
          config.enums,
          at,
        ),
        optional: true,
        nullable: false,
        array: false,
        origin: at,
      };
    }
  }
  const joins = endpoint.joins.map((join) => {
    const relation = Object.values(entity.relations).find(
      (r) => r.target === join.entity,
    ) as ResolvedEntity["relations"][string];
    return {
      ...join,
      relation,
      projection: dictionary(join.fields.map((name) => [name, entities[join.entity].fields[name]])),
      cardinality: relation.cardinality,
      nullable: relation.cardinality === "one" && join.type === "left",
    };
  });
  const authRequired = endpoint.authRequired ?? Boolean(backend.identity);
  const serverDefaults = reference
    ? entity.generatedFields.filter(
        (name) =>
          entity.fields[name].generated === "updated-at" ||
          (reference.operation === "create" && entity.fields[name].generated === "created-at"),
      )
    : [];
  const id = `${entity.moduleId}.${endpoint.operationId}`;
  const access = {
    ...(backend.identity ? { authority: backend.name } : {}),
    authenticated: authRequired,
    roles: endpoint.roles,
    permissions: endpoint.permissions,
  };
  const values = (fields: Readonly<Record<string, ResolvedField>>) =>
    dictionary(
      Object.entries(fields).map(([name, field]) => [
        name,
        { value: field.value, nullable: field.nullable, optional: false, array: false },
      ]),
    );
  const { requestBody: _declaration, ...http } = endpoint;
  return {
    ...http,
    id,
    moduleId: entity.moduleId,
    entityId: entity.id,
    typeName: endpoint.operationId.charAt(0).toUpperCase() + endpoint.operationId.slice(1),
    action:
      reference?.operation ??
      (endpoint.method === "DELETE" ? "delete" : endpoint.method === "GET" ? "query" : "custom"),
    authRequired,
    access,
    pathParams,
    queryParams,
    joins,
    pagination,
    body: {
      kind: reference?.operation ?? (endpoint.requestBody ? "inline" : "none"),
      fields: sortedRecord(Object.entries(bodyFields)),
      dynamicDefaults: Object.keys(bodyFields)
        .sort()
        .filter(
          (name) =>
            bodyFields[name].optional && bodyFields[name].definition.defaultValue.kind === "clock",
        ),
      serverDefaults,
      writeFields: reference ? [...Object.keys(bodyFields), ...serverDefaults] : [],
    },
    input: sortedRecord(Object.entries(input)),
    response: { kind: pagination ? "page" : "rows", entity: entity.fields, joins, status: 200 },
    application: {
      id,
      name: endpoint.operationId,
      input: sortedRecord(
        Object.entries(input).map(([name, field]) => [
          name,
          {
            value: field.definition.value,
            nullable: field.nullable,
            optional: field.optional,
            array: field.array,
          },
        ]),
      ),
      output: {
        kind: pagination ? "page" : "rows",
        entity: values(entity.fields),
        joins: dictionary(
          joins.map((join) => [
            join.entity,
            {
              cardinality: join.cardinality,
              nullable: join.nullable,
              fields: values(join.projection),
            },
          ]),
        ),
      },
      access,
      context: { kind: "trusted-backend-context", backend: endpoint.backend },
      errors: APPLICATION_ERROR_KINDS,
    },
    origin: origin(path),
  };
}

/** More specific static routes win; parameter declaration order is not routing policy. */
export function compareHttpOperations(left: ResolvedOperation, right: ResolvedOperation): number {
  const placeholders = (operation: ResolvedOperation) => operation.pathParams.length;
  const staticSegments = (operation: ResolvedOperation) =>
    operation.path.split("/").filter((s) => s && !s.startsWith("{")).length;
  return (
    Number(placeholders(left) > 0) - Number(placeholders(right) > 0) ||
    staticSegments(right) - staticSegments(left) ||
    left.path.localeCompare(right.path) ||
    left.method.localeCompare(right.method)
  );
}
