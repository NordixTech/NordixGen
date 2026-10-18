import type { FieldDefinition, FrontendDefinition, NordixConfig } from "../configuration/schema.js";
import { normalizeBackends } from "../configuration/schema.js";
import { normalizePaginationConfig } from "../configuration/validate.js";
import { buildIntermediateRepresentation } from "../intermediate-representation.js";
import type { FrontendApiContract, FrontendAuthenticationContract } from "./frontend-contracts.js";

/** Builds only the normalized backend contracts visible to one frontend. */
export function buildFrontendApiContract(
  config: NordixConfig,
  frontend: FrontendDefinition,
): FrontendApiContract {
  const connectedBackends = new Set(frontend.connectsTo);
  const normalized = normalizePaginationConfig(config);
  const representation = buildIntermediateRepresentation(config);
  const endpoints = normalized.endpoints.filter((endpoint) =>
    connectedBackends.has(endpoint.backend),
  );
  const entityNames = new Set<string>();
  for (const endpoint of endpoints) {
    entityNames.add(endpoint.entity);
    for (const join of endpoint.joins) entityNames.add(join.entity);
    for (const parameter of [...endpoint.pathParams, ...endpoint.queryParams]) {
      if (parameter.field) entityNames.add(parameter.field.entity);
    }
    if (!endpoint.requestBody) continue;
    const requestBody = endpoint.requestBody as { useCase?: { entity: string } };
    if (requestBody.useCase) {
      entityNames.add(requestBody.useCase.entity);
      continue;
    }
    for (const definition of Object.values(endpoint.requestBody)) {
      const fieldReference = definition as { field?: { entity: string } };
      if (fieldReference.field) entityNames.add(fieldReference.field.entity);
    }
  }

  const backendByName = new Map(
    normalizeBackends(config).map((backend) => [backend.name, backend]),
  );
  let authentication: FrontendAuthenticationContract | undefined;
  const authorities = frontend.connectsTo.filter((name) => backendByName.get(name)?.authentication);
  const authority =
    frontend.access.backend ?? (authorities.length === 1 ? authorities[0] : undefined);
  for (const backendName of authority ? [authority] : []) {
    const backend = backendByName.get(backendName);
    if (!backend?.authentication) continue;
    authentication = {
      plugin: backend.authentication.plugin,
      backend: backend.name,
      methods: backend.authentication.methods,
      identityProviders: backend.authentication.identityProviders,
      features: backend.authentication.features,
      roles: backend.authorization.roles,
      defaultRole: backend.authorization.defaultRole,
      rolePermissions: backend.authorization.rolePermissions,
    };
    break;
  }

  return {
    endpoints,
    ...(authentication ? { authentication } : {}),
    entities: Object.fromEntries(
      Object.entries(representation.entities)
        .filter(([name]) => entityNames.has(name))
        .map(([name, entity]) => {
          const fields: Record<string, FieldDefinition> = { ...entity.fields };
          for (const relation of Object.values(entity.relations)) {
            if (relation.type !== "many-to-one" && relation.type !== "one-to-one") continue;
            const fieldName = relation.foreignKey ?? `${relation.target.toLowerCase()}_id`;
            fields[fieldName] ??= {
              type: "uuid",
              required: relation.required,
              unique: relation.type === "one-to-one",
            };
          }
          return [
            name,
            {
              fields,
              softDelete: entity.softDelete,
              relations: Object.fromEntries(
                Object.entries(entity.relations).map(([relation, definition]) => [
                  relation,
                  {
                    target: definition.target,
                    type: definition.type,
                  },
                ]),
              ),
            },
          ];
        }),
    ),
    enums: config.enums,
  };
}
