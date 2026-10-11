import type { NormalizedEndpointDefinition } from "../configuration/schema.js";

function operationName(endpoint: NormalizedEndpointDefinition): string {
  const source = endpoint.operationId ?? `${endpoint.method}_${endpoint.path.replace(/[{}]/g, "")}`;
  const words = source.match(/[A-Za-z0-9]+/g) ?? ["request"];
  const result = words
    .map((word, index) =>
      index === 0 ? word[0]?.toLowerCase() + word.slice(1) : word[0]?.toUpperCase() + word.slice(1),
    )
    .join("");
  return /^[a-z]/.test(result) ? result : `request${result}`;
}

/** Provides stable, collision-safe method names shared by API and state plugins. */
export function getFrontendOperationNames(
  endpoints: readonly NormalizedEndpointDefinition[],
): Map<NormalizedEndpointDefinition, string> {
  const counts = new Map<string, number>();
  for (const endpoint of endpoints) {
    const name = operationName(endpoint);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const used = new Set<string>();
  return new Map(
    endpoints.map((endpoint) => {
      const base = operationName(endpoint);
      const candidate =
        (counts.get(base) ?? 0) > 1
          ? `${endpoint.backend}${base[0]?.toUpperCase()}${base.slice(1)}`
          : base;
      let name = candidate;
      let suffix = 2;
      while (used.has(name)) name = `${candidate}${suffix++}`;
      used.add(name);
      return [endpoint, name];
    }),
  );
}
