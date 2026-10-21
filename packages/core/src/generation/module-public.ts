import { posix } from "node:path";
import type { BackendRenderContext, GeneratedFile } from "../plugins/contracts.js";
import type {
  ApplicationValue,
  PublicApplicationContract,
  ResolvedProject,
} from "../project/types.js";
function importPath(from: string, to: string) {
  const path = posix.relative(posix.dirname(from), to.replace(/\.ts$/, ".js"));
  return path.startsWith(".") ? path : `./${path}`;
}
function valueType(field: ApplicationValue): string {
  const value = field.value.applicationType + (field.nullable ? " | null" : "");
  return field.array ? `readonly (${value})[]` : value;
}
function fields(values: Readonly<Record<string, ApplicationValue>>): string {
  return `{ ${Object.entries(values)
    .map(
      ([name, field]) =>
        `readonly ${JSON.stringify(name)}${field.optional ? "?" : ""}: ${valueType(field)};`,
    )
    .join(" ")} }`;
}
function output(contract: PublicApplicationContract): string {
  const joins = Object.entries(contract.output.joins)
    .map(
      ([name, join]) =>
        `readonly ${JSON.stringify(name)}: ${join.cardinality === "many" ? `readonly ${fields(join.fields)}[]` : fields(join.fields) + (join.nullable ? " | null" : "")};`,
    )
    .join(" ");
  const rows = `readonly {readonly entity:${fields(contract.output.entity)};readonly joins:{${joins}}}[]`;
  return contract.output.kind === "page"
    ? `{readonly items:${rows};readonly total:number;readonly page:number;readonly pageSize:number;}`
    : rows;
}
function contractSource(
  operations: readonly { typeName: string; application: PublicApplicationContract }[],
  name: string,
  shared: string,
): string {
  return [
    `import type {OperationContext,ApplicationResult} from "${shared}";`,
    ...operations.flatMap((operation) => [
      `export type ${operation.typeName}Input=${fields(operation.application.input)};`,
      `export type ${operation.typeName}Output=${output(operation.application)};`,
    ]),
    `export interface ${name} {`,
    ...operations.map(
      (operation) =>
        `readonly ${JSON.stringify(operation.application.name)}:(input:${operation.typeName}Input,context:OperationContext)=>Promise<ApplicationResult<${operation.typeName}Output>>;`,
    ),
    "}",
    "",
  ].join("\n");
}
export function generateModulePublicFiles(
  project: ResolvedProject,
  context: BackendRenderContext,
): readonly GeneratedFile[] {
  const root = context.framework.codeRoot;
  const module = project.modules[context.moduleId as string];
  const operations = context.domainModel.endpoints;
  const contracts = `${root}/public/contracts.ts`;
  const applicationContracts = `${root}/${context.architecture.applicationRoot}/operation-contracts.ts`;
  const runtime = `${root}/public/runtime.ts`;
  const imports = `${root}/${context.architecture.applicationRoot}/ports/module-dependencies.ts`;
  const bootstrap = `${root}/bootstrap.ts`;
  const exported = operations.filter((operation) => module.exports.includes(operation.id));
  const shared = `${context.platformRoot}/application/contracts.ts`;
  const access = `${context.platformRoot}/application/access.ts`;
  return [
    {
      path: contracts,
      content: contractSource(exported, "PublicApi", importPath(contracts, shared)),
    },
    {
      path: applicationContracts,
      content: contractSource(operations, "OperationApi", importPath(applicationContracts, shared)),
    },
    {
      path: `${root}/index.ts`,
      content: `export type {PublicApi${exported.flatMap((operation) => [`,${operation.typeName}Input`, `,${operation.typeName}Output`]).join("")}} from "./public/contracts.js";\n`,
    },
    {
      path: imports,
      content: [
        ...module.imports.map(
          (dependency, index) =>
            `import type {PublicApi as Producer${index}} from "${importPath(imports, `${context.moduleRoots[dependency.moduleId]}/index.ts`)}";`,
        ),
        "export interface ModuleDependencies {",
        ...module.imports.map(
          (dependency, index) =>
            `readonly ${JSON.stringify(project.modules[dependency.moduleId].name)}:Pick<Producer${index},${dependency.operations.map((id) => JSON.stringify(project.operations[id].operationId)).join("|")}>;`,
        ),
        "}",
        "",
      ].join("\n"),
    },
    {
      path: runtime,
      content: [
        'import {ZodError} from "zod";',
        `import {ApplicationFailure} from "${importPath(runtime, shared)}";`,
        `import type {OperationContext} from "${importPath(runtime, shared)}";`,
        `import type {AccessGuard} from "${importPath(runtime, access)}";`,
        `import type {PublicApi} from "./contracts.js";`,
        `import type {OperationApi${operations.map((operation) => `,${operation.typeName}Output`).join("")}} from "${importPath(runtime, applicationContracts)}";`,
        "interface Executions {",
        ...operations.map(
          (operation) =>
            `readonly ${JSON.stringify(operation.operationId)}:{readonly useCase:{execute(input:unknown,context?:OperationContext):Promise<${operation.typeName}Output>}};`,
        ),
        "}",
        `const policies={${operations.map((operation) => `${JSON.stringify(operation.operationId)}:${JSON.stringify(operation.access)}`).join(",")}} as const;`,
        "export function createApplicationApi(executions:Executions,authorize:AccessGuard) {",
        "const checkAccess=(name:keyof OperationApi,context:OperationContext)=>authorize(context,policies[name]);",
        "const operations:OperationApi={",
        ...operations.map(
          (operation) =>
            `${JSON.stringify(operation.operationId)}:async(input,context)=>{const denied=checkAccess(${JSON.stringify(operation.operationId)},context);if(denied)return {ok:false,error:denied};try{return {ok:true,value:await executions[${JSON.stringify(operation.operationId)}].useCase.execute(input,context)};}catch(error){if(error instanceof ApplicationFailure)return {ok:false,error:error.error.code==="unexpected"?{code:"unexpected",message:"An unexpected error occurred"}:error.error};if(error instanceof ZodError)return {ok:false,error:{code:"validation",message:"Invalid application input."}};return {ok:false,error:{code:"unexpected",message:"An unexpected error occurred"}};}},`,
        ),
        "};",
        `return {checkAccess,operations,public:{${exported.map((operation) => `${JSON.stringify(operation.operationId)}:operations[${JSON.stringify(operation.operationId)}]`).join(",")}}};`,
        "}",
        "",
      ].join("\n"),
    },
    ...(context.persistence
      ? [
          {
            path: bootstrap,
            content: [
              `import {createRouteDependencies} from "${importPath(bootstrap, posix.join(root, context.architecture.directories.adapter, "create-route-dependencies.ts"))}";`,
              'import {createApplicationApi} from "./public/runtime.js";',
              `import type {ModuleDependencies} from "${importPath(bootstrap, imports)}";`,
              `import type {DrizzleDatabase} from "${importPath(bootstrap, context.sharedDatabaseFile as string)}";`,
              `import type {AccessGuard} from "${importPath(bootstrap, access)}";`,
              ...(context.domainModel.backend.storage.length
                ? [
                    `import type {StoragePort} from "${importPath(bootstrap, posix.join(context.platformRoot, "../application/ports/storage-port.ts"))}";`,
                  ]
                : []),
              `export function createModule(db:DrizzleDatabase,dependencies:ModuleDependencies,authorize:AccessGuard${context.domainModel.backend.storage.length ? ",storage:Readonly<Record<string,StoragePort>>" : ""}) {`,
              "const executions=createRouteDependencies(db);",
              `return {...createApplicationApi(executions.endpoints,authorize),dependencies${context.domainModel.backend.storage.length ? ",storage" : ""}};`,
              "}",
              "",
            ].join("\n"),
          },
        ]
      : []),
  ];
}
