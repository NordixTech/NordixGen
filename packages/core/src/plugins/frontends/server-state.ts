import type { GeneratedFile } from "../contracts.js";
import type { FrontendRenderContext } from "../frontend-contracts.js";
function namesFor(context: FrontendRenderContext) {
  return context.api.endpoints.map((endpoint) => context.api.operationNames[endpoint.id]);
}
function inputRequired(endpoint: FrontendRenderContext["api"]["endpoints"][number]): boolean {
  return (
    endpoint.pathParams.length > 0 || endpoint.queryParams.some((parameter) => parameter.required)
  );
}
function tanStackHooks(context: FrontendRenderContext) {
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
    const details = "";
    const invalidationKeys = endpoint.invalidates;
    return `export function use${name[0]?.toUpperCase()}${name.slice(1)}() {\n  const queryClient = useQueryClient();\n  return useMutation({ mutationFn: (input: ${name}Input) => ${name}(input),${details}\n    onSettled: () => Promise.all(${JSON.stringify(invalidationKeys)}.map((affectedEntity) => queryClient.invalidateQueries({ queryKey: [affectedEntity] }))),\n  });\n}`;
  });
  const helper = "";
  return `"use client";\n\n${[...new Set(imports)].join("\n")}\nimport { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";\n\n${helper}\n${hooks.join("\n\n")}\n`;
}
export function generateQueryFiles(context: FrontendRenderContext): readonly GeneratedFile[] {
  return [
    { path: `${context.framework.codeRoot}/lib/api/hooks.ts`, content: tanStackHooks(context) },
  ];
}
