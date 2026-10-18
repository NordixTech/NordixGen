import type { GeneratedFile } from "../contracts.js";
import type { FrontendRenderContext } from "../frontend-contracts.js";
function inputRequired(endpoint: FrontendRenderContext["api"]["endpoints"][number]): boolean {
  return (
    endpoint.pathParams.length > 0 || endpoint.queryParams.some((parameter) => parameter.required)
  );
}
export function generateQueryFiles(context: FrontendRenderContext): readonly GeneratedFile[] {
  const operations = context.api.endpoints;
  const names = context.api.operationNames;
  const scopedKey = (operation: (typeof operations)[number]) => [
    "nordixgen",
    operation.backend,
    operation.moduleId,
    operation.id,
  ];
  const imports = operations.flatMap((operation) => [
    `import {${names[operation.id]}} from "@/lib/api/endpoints";`,
    `import type {${names[operation.id]}Input} from "@/lib/api/types";`,
  ]);
  const hooks = operations.map((operation) => {
    const name = names[operation.id];
    const hook = `use${name[0].toUpperCase()}${name.slice(1)}`;
    const privateData =
      operation.authRequired || operation.roles.length > 0 || operation.permissions.length > 0;
    const policy = JSON.stringify({
      authRequired: operation.authRequired,
      roles: operation.roles,
      permissions: operation.permissions,
    });
    const access = context.api.authentication
      ? `const session=useSessionView();const allowed=session.canAccess(${policy});`
      : "const allowed=true;";
    if (operation.method === "GET")
      return `export function ${hook}(input:${name}Input${inputRequired(operation) ? "" : "={}"}) {${access}
return useQuery({queryKey:[...${JSON.stringify(scopedKey(operation))},${privateData ? '["private",session.user?.id??null,session.user?.role??null]' : '["public"]'},input] as const,enabled:allowed,queryFn:({signal})=>${name}(input,{signal})});}`;
    const affected = operation.invalidates.map((id) =>
      scopedKey(operations.find((candidate) => candidate.id === id) as typeof operation),
    );
    return `export function ${hook}(){${access}const client=useQueryClient();return useMutation({mutationFn:(input:${name}Input)=>{if(!allowed)throw new Error("The current session cannot perform this operation.");return ${name}(input);},onSettled:()=>Promise.all(${JSON.stringify(affected)}.map(queryKey=>client.invalidateQueries({queryKey})))});}`;
  });
  const root = context.framework.codeRoot;
  return [
    {
      path: `${root}/lib/api/hooks.ts`,
      content: `"use client";\n${imports.join("\n")}\nimport {useQuery,useMutation,useQueryClient} from "@tanstack/react-query";\n${context.api.authentication ? 'import {useSessionView} from "@/lib/auth/use-session-view";' : ""}\n${hooks.join("\n")}\n`,
    },
    {
      path: `${root}/lib/api/cache.ts`,
      content: `import {QueryClient} from "@tanstack/react-query";
/** Scalar presentation scope only; Better Auth remains the session source. A new keyed provider owns each cache. */
export function sessionCacheIdentity(session:{isPending:boolean;user:{id:string;role?:string|null}|null}):string {return session.isPending?"pending":session.user?JSON.stringify(["user",session.user.id,session.user.role??null]):"anonymous";}
export function createSessionQueryCache(){const client=new QueryClient();return {client,dispose:()=>{void client.cancelQueries().finally(()=>client.clear());}};}
`,
    },
  ];
}
