import type { NordixConfig } from "./schema.js";

/** Only call on Zod's fresh structural result, never on caller-owned input/default values. */
export function isolateConfigurationDictionaries(config: NordixConfig): NordixConfig {
  const records: object[] = [config.databases, config.enums, config.entities, config.pagination];
  if (config.iac) records.push(config.iac.cloudflare.r2_storage);
  for (const backend of config.backends) {
    records.push(backend.modules);
    for (const module of Object.values(backend.modules)) records.push(module.imports);
    if (backend.authorization)
      records.push(
        backend.authorization.global.rolePermissions,
        backend.authorization.organizations.rolePermissions,
      );
  }
  for (const entity of Object.values(config.entities))
    records.push(entity.fields, entity.relations);
  for (const endpoint of config.endpoints) {
    if (endpoint.requestBody && !Object.hasOwn(endpoint.requestBody, "useCase"))
      records.push(endpoint.requestBody);
  }
  for (const record of records) Object.setPrototypeOf(record, null);
  return config;
}
