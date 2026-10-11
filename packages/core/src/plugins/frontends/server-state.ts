import type { FrontendGeneratorPlugin } from "../frontend-contracts.js";
import { getFrontendOperationNames } from "../frontend-operation-names.js";
import { frontendRootShellFiles } from "./root-shell.js";

function namesFor(context: Parameters<FrontendGeneratorPlugin["contribute"]>[0]) {
  const names = getFrontendOperationNames(context.api.endpoints);
  return context.api.endpoints.map((endpoint) => names.get(endpoint) as string);
}

function inputRequired(
  endpoint: Parameters<FrontendGeneratorPlugin["contribute"]>[0]["api"]["endpoints"][number],
): boolean {
  return (
    endpoint.pathParams.length > 0 || endpoint.queryParams.some((parameter) => parameter.required)
  );
}

function affectedEntities(
  context: Parameters<FrontendGeneratorPlugin["contribute"]>[0],
  entity: string,
): string[] {
  return [
    ...new Set([
      entity,
      ...context.api.endpoints
        .filter(
          (endpoint) =>
            endpoint.method === "GET" && endpoint.joins.some((join) => join.entity === entity),
        )
        .map((endpoint) => endpoint.entity),
    ]),
  ].sort();
}

function tanStackHooks(context: Parameters<FrontendGeneratorPlugin["contribute"]>[0]) {
  const names = namesFor(context);
  const imports = context.api.endpoints.flatMap((endpoint, index) => [
    `import { ${names[index]} } from "@/lib/api/endpoints";`,
    `import type { ${names[index]}Input } from "@/lib/api/types";`,
  ]);
  const hooks = context.api.endpoints.map((endpoint, index) => {
    const name = names[index] as string;
    const entity = endpoint.entity;
    if (endpoint.method === "GET") {
      return `export function use${name[0]?.toUpperCase()}${name.slice(1)}(input: ${name}Input${inputRequired(endpoint) ? "" : " = {}"}) {\n  return useQuery({ queryKey: [${JSON.stringify(entity)}, ${JSON.stringify(name)}, input] as const, queryFn: () => ${name}(input) });\n}`;
    }
    const optimistic =
      typeof context.frontend.stateManagement === "object" &&
      context.frontend.stateManagement.optimisticUpdates;
    const idParameter =
      endpoint.pathParams.find(
        (parameter) => parameter.field?.entity === entity && parameter.field.field === "id",
      ) ??
      endpoint.pathParams.find((parameter) => parameter.name === "id") ??
      (endpoint.pathParams.length === 1 && endpoint.pathParams[0]?.type === "uuid"
        ? endpoint.pathParams[0]
        : undefined);
    const enableOptimism =
      optimistic &&
      idParameter !== undefined &&
      ["PATCH", "PUT", "DELETE"].includes(endpoint.method);
    const details = enableOptimism
      ? `\n      onMutate: async (input: ${name}Input) => {\n        const queryKey = [${JSON.stringify(entity)}] as const;\n        await queryClient.cancelQueries({ queryKey });\n        const previous = queryClient.getQueriesData({ queryKey });\n        for (const [key, data] of previous) queryClient.setQueryData(key, applyOptimisticChange(data, ${JSON.stringify(endpoint.method)}, ${endpoint.requestBody ? "input.body" : "undefined"}, input.path?.[${JSON.stringify(idParameter?.name)}]));\n        return { queryKey, previous };\n      },\n      onError: (_error, _input, context) => { for (const [key, data] of context?.previous ?? []) queryClient.setQueryData(key, data); },`
      : "";
    const invalidationKeys = affectedEntities(context, entity);
    return `export function use${name[0]?.toUpperCase()}${name.slice(1)}() {\n  const queryClient = useQueryClient();\n  return useMutation({ mutationFn: (input: ${name}Input) => ${name}(input),${details}\n    onSettled: () => Promise.all(${JSON.stringify(invalidationKeys)}.map((affectedEntity) => queryClient.invalidateQueries({ queryKey: [affectedEntity] }))),\n  });\n}`;
  });
  const optimistic =
    typeof context.frontend.stateManagement === "object" &&
    context.frontend.stateManagement.optimisticUpdates;
  const helper = optimistic
    ? `\nfunction applyOptimisticChange(data: unknown, method: string, body: object | undefined, id: unknown): unknown {\n  if (id === undefined) return data;\n  const transformRows = (rows: readonly unknown[]) => rows.flatMap((row) => {\n    if (!row || typeof row !== "object" || !("entity" in row)) return [row];\n    const entity = (row as { entity: Record<string, unknown> }).entity;\n    if (entity.id !== id) return [row];\n    if (method === "DELETE") return [];\n    if (method === "PATCH" || method === "PUT") return [{ ...(row as object), entity: { ...entity, ...(body ?? {}) } }];\n    return [row];\n  });\n  if (Array.isArray(data)) return transformRows(data);\n  if (data && typeof data === "object" && "items" in data && Array.isArray((data as { items: unknown }).items)) {\n    const page = data as { items: readonly unknown[]; total: number };\n    const items = transformRows(page.items);\n    return { ...page, items, total: method === "DELETE" ? Math.max(0, page.total - (page.items.length - items.length)) : page.total };\n  }\n  return data;\n}\n`
    : "";
  return `"use client";\n\n${[...new Set(imports)].join("\n")}\nimport { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";\n\n${helper}\n${hooks.join("\n\n")}\n`;
}

function swrHooks(context: Parameters<FrontendGeneratorPlugin["contribute"]>[0]) {
  const names = namesFor(context);
  const imports = context.api.endpoints.flatMap((endpoint, index) => [
    `import { ${names[index]} } from "@/lib/api/endpoints";`,
    `import type { ${names[index]}Input } from "@/lib/api/types";`,
  ]);
  const hooks = context.api.endpoints.map((endpoint, index) => {
    const name = names[index] as string;
    const affected = affectedEntities(context, endpoint.entity);
    if (endpoint.method === "GET")
      return `export function use${name[0]?.toUpperCase()}${name.slice(1)}(input: ${name}Input${inputRequired(endpoint) ? "" : " = {}"}) {\n  return useSWR([${JSON.stringify(endpoint.entity)}, ${JSON.stringify(name)}, input], () => ${name}(input));\n}`;
    return `export function use${name[0]?.toUpperCase()}${name.slice(1)}() {\n  const { mutate } = useSWRConfig();\n  return useSWRMutation([${JSON.stringify(endpoint.entity)}, ${JSON.stringify(name)}], (_key, { arg }: { arg: ${name}Input }) => ${name}(arg), { onSuccess: () => mutate((key) => Array.isArray(key) && ${JSON.stringify(affected)}.includes(String(key[0]))) });\n}`;
  });
  return `"use client";\n\n${[...new Set(imports)].join("\n")}\nimport useSWR, { useSWRConfig } from "swr";\nimport useSWRMutation from "swr/mutation";\n\n${hooks.join("\n\n")}\n`;
}

export const tanstackQueryServerStatePlugin: FrontendGeneratorPlugin = {
  descriptor: {
    id: "tanstack-query",
    version: "1.0.0",
    role: "server-state",
    provides: ["server-state:tanstack-query"],
    dependencies: { "@tanstack/react-query": "^5.80.7" },
  },
  contribute(context) {
    if (
      context.frontend.stateManagement === undefined ||
      typeof context.frontend.stateManagement !== "object" ||
      !context.frontend.stateManagement.generateHooks
    )
      return [];
    const root = context.framework.codeRoot;
    return [
      { path: `${root}/lib/api/hooks.ts`, content: tanStackHooks(context) },
      ...frontendRootShellFiles(context, "server-state"),
    ];
  },
};

export const swrServerStatePlugin: FrontendGeneratorPlugin = {
  descriptor: {
    id: "swr",
    version: "1.0.0",
    role: "server-state",
    provides: ["server-state:swr"],
    dependencies: { swr: "^2.3.3" },
  },
  contribute(context) {
    if (
      context.frontend.stateManagement === undefined ||
      typeof context.frontend.stateManagement !== "object" ||
      !context.frontend.stateManagement.generateHooks
    )
      return [];
    return [{ path: `${context.framework.codeRoot}/lib/api/hooks.ts`, content: swrHooks(context) }];
  },
};
