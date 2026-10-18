import type { BackendRenderContext, GeneratedFile } from "../plugins/contracts.js";
import type { ResolvedProject } from "../project/types.js";
export function generateModuleComposition(
  project: ResolvedProject,
  context: BackendRenderContext,
): GeneratedFile {
  const modules = context.domainModel.modules;
  const index = new Map(modules.map((module, index) => [module.id, index]));
  const path = `${context.platformRoot}/database/create-route-dependencies.ts`;
  return {
    path,
    content: [
      'import {createDrizzleDatabase,type DrizzleDatabase} from "./drizzle-database.js";',
      'import type {AccessGuard,OperationBoundary} from "../application/access.js";',
      'import {ApplicationFailure} from "../application/contracts.js";',
      ...modules.map(
        (module, index) =>
          `import {createModule as module${index}} from "../../modules/${module.name}/bootstrap.js";`,
      ),
      "export function composeModules(db:DrizzleDatabase,authorize:AccessGuard) {",
      ...modules.map(
        (module, i) =>
          `const instance${i}=module${i}(db,{${module.imports
            .map(
              (dependency) =>
                `${JSON.stringify(project.modules[dependency.moduleId].name)}:{${dependency.operations
                  .map((id) => {
                    const operation = project.operations[id];
                    return `${JSON.stringify(operation.operationId)}:instance${index.get(dependency.moduleId)}.public[${JSON.stringify(operation.operationId)}]`;
                  })
                  .join(",")}}`,
            )
            .join(",")}},authorize);`,
      ),
      `return Object.freeze({${modules.map((module, i) => `${JSON.stringify(module.name)}:instance${i}`).join(",")}});`,
      "}",
      "export function createRouteDependencies(connectionString:string,boundary:OperationBoundary,headers:Headers) {",
      "const db=createDrizzleDatabase(connectionString);const modules=composeModules(db,boundary.authorize);",
      "return {modules,endpoints:{",
      ...context.domainModel.endpoints.map((operation) => {
        const name = project.modules[operation.moduleId].name;
        const type = `Parameters<(typeof modules)[${JSON.stringify(name)}]["operations"][${JSON.stringify(operation.operationId)}]>[0]`;
        return `${JSON.stringify(operation.operationId)}:{authorize:()=>boundary.run(headers,async context=>{const denied=modules[${JSON.stringify(name)}].checkAccess(${JSON.stringify(operation.operationId)},context);if(denied)throw new ApplicationFailure(denied);}),useCase:{execute:(input:unknown)=>boundary.run(headers,async context=>{const result=await modules[${JSON.stringify(name)}].operations[${JSON.stringify(operation.operationId)}](input as ${type},context);if(!result.ok)throw new ApplicationFailure(result.error);return result.value;})}},`;
      }),
      "}};",
      "}",
      "",
    ].join("\n"),
  };
}
