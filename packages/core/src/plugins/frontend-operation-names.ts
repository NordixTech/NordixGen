import type { NormalizedEndpointDefinition } from "../configuration/schema.js";
import { scopedOperationName } from "../configuration/validation/shared.js";
/** Names explicit canonical operations, qualifying shared IDs by backend. */
export function getFrontendOperationNames(
  endpoints: readonly NormalizedEndpointDefinition[],
): Map<NormalizedEndpointDefinition, string> {
  const counts = new Map<string, number>();
  for (const endpoint of endpoints)
    counts.set(endpoint.operationId, (counts.get(endpoint.operationId) ?? 0) + 1);
  const used = new Set<string>();
  return new Map(
    endpoints.map((endpoint) => {
      const id = endpoint.operationId;
      const name = scopedOperationName(endpoint.backend, id, counts.get(id) !== 1);
      if (used.has(name))
        throw new Error(
          "Conflicting generated operation names. Correct the scoped operation declarations.",
        );
      used.add(name);
      return [endpoint, name];
    }),
  );
}
