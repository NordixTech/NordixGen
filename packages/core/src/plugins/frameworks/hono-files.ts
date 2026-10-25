import { posix } from "node:path";
import { resolveArchitectureLayout } from "../architecture/layout.js";
import type { BackendRenderContext, DomainModelContext, GeneratedFile } from "../contracts.js";

function relativeImport(fromFile: string, toFile: string): string {
  let importPath = posix.relative(posix.dirname(fromFile), toFile).replace(/\.ts$/, ".js");
  if (!importPath.startsWith(".")) importPath = `./${importPath}`;
  return importPath;
}

function endpointTypeName(endpoint: DomainModelContext["endpoints"][number]): string {
  return endpoint.typeName;
}

function lowerFirst(value: string): string {
  return value.charAt(0).toLowerCase() + value.slice(1);
}

export function generateHonoFiles(context: BackendRenderContext): readonly GeneratedFile[] {
  const framework = context.framework;
  const architecture = context.architecture;
  const entryPoint = framework.entryPoints.worker;

  const controllerDirectory = posix.join(framework.codeRoot, architecture.directories.controller);
  const healthControllerPath = posix.join(controllerDirectory, "health.controller.ts");
  const routesPath = posix.join(controllerDirectory, "routes.ts");
  const hasAuthentication = Boolean(context.identity);
  const hasDrizzle = Boolean(context.persistence);
  const hasAudit = modelAudit(context).length > 0;
  const hasStorage = Boolean(context.domainModel.backend.storage.length);
  const infrastructureDirectory = posix.join(
    framework.codeRoot,
    architecture.directories.infrastructure,
  );
  const authFilePath = posix.join(infrastructureDirectory, "auth/auth.ts");

  const model = context.domainModel;

  const problemDetailsPath = posix.join(context.platformRoot, "http/problem-details.ts");
  const files: GeneratedFile[] = [];

  // 1. RFC 7807 Problem Details utility
  files.push({
    path: problemDetailsPath,
    content: [
      'import type { Context } from "hono";',
      "",
      "export interface ProblemDetails {",
      "  type: string;",
      "  title: string;",
      "  status: number;",
      "  detail?: string;",
      "  instance?: string;",
      "  errors?: unknown;",
      "}",
      "",
      "export function problemResponse(",
      "  c: Context,",
      "  status: number,",
      "  title: string,",
      "  detail?: string,",
      "  errors?: unknown,",
      '  type = "https://tools.ietf.org/html/rfc7807",',
      ") {",
      "  return c.json(",
      "    {",
      "      type,",
      "      title,",
      "      status,",
      "      ...(detail !== undefined ? { detail } : {}),",
      "      instance: c.req.path,",
      "      ...(errors !== undefined ? { errors } : {}),",
      "    },",
      "    // @ts-expect-error Hono status code union",
      "    status,",
      '    { "Content-Type": "application/problem+json" },',
      "  );",
      "}",
      "",
    ].join("\n"),
  });

  // 2. Health controller
  files.push({
    path: healthControllerPath,
    content: [
      'import { Hono } from "hono";',
      "",
      "const healthController = new Hono();",
      'healthController.get("/", (context) => context.json({ status: "ok" }));',
      "",
      "export default healthController;",
      "",
    ].join("\n"),
  });

  const routesImports: string[] = [
    'import { Hono } from "hono";',
    'import { HTTPException } from "hono/http-exception";',
    `import healthController from "${relativeImport(routesPath, healthControllerPath)}";`,
    `import { problemResponse } from "${relativeImport(routesPath, problemDetailsPath)}";`,
    `import {applicationProblem} from "${relativeImport(routesPath, posix.join(context.platformRoot, "http/application-error.ts"))}";`,
  ];
  const routesRegistrations: string[] = ['  routes.route("/health", healthController);'];

  // 3. Declared business endpoint controllers
  for (const endpoint of model.endpoints) {
    const operationName = endpointTypeName(endpoint);
    const moduleRoot = context.moduleRoots[endpoint.moduleId];
    const module = model.modules.filter((module) => module.id === endpoint.moduleId)[0];
    const moduleLayout = resolveArchitectureLayout(module.architecture);
    const controllerPath = posix.join(
      moduleRoot,
      moduleLayout.directories.controller,
      `${lowerFirst(operationName)}.controller.ts`,
    );
    const endpointDtoPath = posix.join(
      moduleRoot,
      moduleLayout.directories.useCase,
      "dtos/endpoints",
      `${operationName}.dto.ts`,
    );
    const endpointUseCasePath = posix.join(
      moduleRoot,
      moduleLayout.directories.useCase,
      `${operationName}.use-case.ts`,
    );

    const problemImport = relativeImport(controllerPath, problemDetailsPath);
    const dtoImport = relativeImport(controllerPath, endpointDtoPath);
    const explicitPort = module.architecture !== "clean";
    const useCaseImport = relativeImport(
      controllerPath,
      explicitPort
        ? posix.join(moduleRoot, moduleLayout.inboundPort, `${operationName}.port.ts`)
        : endpointUseCasePath,
    );

    const hasPathParams = endpoint.pathParams.length > 0;
    // Even an empty declared query contract rejects undeclared query names.
    const hasRequestBody = endpoint.body.kind !== "none";
    const isSecured = endpoint.access.authenticated;
    const httpMethod = endpoint.method.toLowerCase();
    const honoPath = endpoint.path.replace(/\{([^{}]+)\}/g, ":$1");

    const dtoImportsList: string[] = [];
    if (hasPathParams) dtoImportsList.push("PathParamsSchema");
    dtoImportsList.push("QueryParamsSchema");
    if (hasRequestBody) dtoImportsList.push("RequestBodySchema");

    const validatorsList: string[] = [];
    const authorizationHandlers = [
      "    async (c, next) => {",
      '      if(!deps?.authorize)return problemResponse(c,500,"Internal Server Error","Operation boundary not configured");',
      "      await deps.authorize();",
      ...(isSecured
        ? [
            '      if (["POST", "PUT", "PATCH", "DELETE"].includes(c.req.method) && !isTrustedAuthOrigin(c.req.header("origin"), c.env as AuthEnvironment)) return problemResponse(c, 403, "Forbidden", "A trusted Origin header is required for state-changing requests");',
          ]
        : []),
      "      await next();",
      "    },",
    ];
    if (hasPathParams) {
      validatorsList.push(
        '    zValidator("param", PathParamsSchema, (result, c) => {',
        "      if (!result.success) {",
        '        return problemResponse(c, 400, "Validation Failed", "Invalid path parameters", result.error.issues);',
        "      }",
        "    }),",
      );
    }
    validatorsList.push(
      '    zValidator("query", QueryParamsSchema, (result, c) => {',
      "      if (!result.success) {",
      '        return problemResponse(c, 400, "Validation Failed", "Invalid query parameters", result.error.issues);',
      "      }",
      "    }),",
    );
    if (hasRequestBody) {
      validatorsList.push(
        '    zValidator("json", RequestBodySchema, (result, c) => {',
        "      if (!result.success) {",
        '        return problemResponse(c, 400, "Validation Failed", "Invalid request body", result.error.issues);',
        "      }",
        "    }),",
      );
    }

    const controllerContent = [
      'import { Hono } from "hono";',
      'import { zValidator } from "@hono/zod-validator";',
      ...(isSecured && hasAuthentication
        ? [
            `import { isTrustedAuthOrigin, type AuthEnvironment } from "${relativeImport(controllerPath, authFilePath)}";`,
          ]
        : []),
      `import { problemResponse } from "${problemImport}";`,
      ...(dtoImportsList.length > 0
        ? [`import { ${dtoImportsList.join(", ")} } from "${dtoImport}";`]
        : []),
      explicitPort
        ? `import type {${operationName}Port} from "${useCaseImport}";`
        : `import { ${operationName}UseCase } from "${useCaseImport}";`,
      "",
      `export interface ${operationName}ControllerDependencies {`,
      `  useCase?: ${endpoint.access.scope === "organization" ? `{execute(input:unknown):ReturnType<${operationName}${explicitPort ? "Port" : "UseCase"}["execute"]>}` : explicitPort ? `${operationName}Port` : `Pick<${operationName}UseCase,"execute">`};`,
      "  authorize?:()=>Promise<void>;",
      "}",
      "",
      `export function create${operationName}EndpointController(deps?: ${operationName}ControllerDependencies): Hono {`,
      "  const router = new Hono();",
      "",
      `  router.${httpMethod}(`,
      `    ${JSON.stringify(honoPath)},`,
      ...authorizationHandlers,
      ...validatorsList,
      "    async (c) => {",
      "      const useCase = deps?.useCase;",
      "      if (!useCase) {",
      `        return problemResponse(c, 500, "Internal Server Error", "${operationName}UseCase not configured");`,
      "      }",
      `      const path = ${hasPathParams ? 'c.req.valid("param")' : "{}"};`,
      '      const query = c.req.valid("query");',
      ...(hasRequestBody ? ['      const body = c.req.valid("json");'] : []),
      `      const rawInput = { ...path, ...query${hasRequestBody ? ", ...body" : ""} };`,
      "      const response = await useCase.execute(rawInput);",
      "      return c.json(response, 200);",
      "    },",
      "  );",
      "",
      "  return router;",
      "}",
      "",
      `export default create${operationName}EndpointController();`,
      "",
    ].join("\n");

    files.push({
      path: controllerPath,
      content: controllerContent,
    });

    const endpointFactoryName = `create${operationName}EndpointController`;
    const routeVar = `${lowerFirst(operationName)}EndpointController`;
    routesImports.push(
      `import ${routeVar}, { ${endpointFactoryName} } from "${relativeImport(routesPath, controllerPath)}";`,
    );
    routesRegistrations.push(
      `  routes.route("/", deps?.endpoints?.${lowerFirst(operationName)} ? ${endpointFactoryName}(deps.endpoints.${lowerFirst(operationName)}) : ${routeVar});`,
    );
  }

  // 4. Routes aggregator
  files.push({
    path: routesPath,
    content: [
      ...routesImports,
      "",
      "export interface RoutesDependencies {",
      "  endpoints?: Record<string, unknown>;",
      "}",
      "",
      "export function createRoutes(deps?: RoutesDependencies): Hono {",
      "  const routes = new Hono();",
      '  routes.onError((error, c) => applicationProblem(c,error) ?? (error instanceof HTTPException && error.status === 400 ? problemResponse(c, 400, "Validation Failed", "Malformed request data") : problemResponse(c, 500, "Internal Server Error", "An unexpected error occurred")));',
      ...routesRegistrations,
      '  routes.notFound((c) => problemResponse(c, 404, "Not Found", `Route not found: ${c.req.path}`));',
      "  return routes;",
      "}",
      "",
      "const routes = createRoutes();",
      "export default routes;",
      "",
    ].join("\n"),
  });

  // 5. Entrypoint with RFC 7807 error and notFound handlers
  const routesImport = relativeImport(entryPoint, routesPath);
  const problemImportInIndex = relativeImport(entryPoint, problemDetailsPath);
  const dependenciesFactoryPath = posix.join(
    framework.codeRoot,
    architecture.directories.adapter,
    "create-route-dependencies.ts",
  );

  files.push({
    path: entryPoint,
    content: [
      ...(hasStorage
        ? [
            'import {createStorage,type StorageEnvironment} from "./platform/storage/create-storage.js";',
            'import {createStorageRoutes} from "./platform/storage/routes.js";',
          ]
        : []),
      ...(hasAudit
        ? [
            'import {beginBusinessAudit,createAuditService} from "./platform/audit/runtime.js";',
            'import {createAuditWriter} from "./platform/audit/store.js";',
          ]
        : []),
      'import { Hono } from "hono";',
      'import { HTTPException } from "hono/http-exception";',
      'import { cors } from "hono/cors";',
      ...(model.backend.ai ? ['import {createAiRoutes} from "./platform/ai/routes.js";'] : []),
      ...(hasAuthentication
        ? [
            `import { createAuth, isTrustedAuthOrigin, type AuthEnvironment } from "${relativeImport(entryPoint, authFilePath)}";`,
            'import {createIamRepository} from "./platform/authorization/repository.js";',
            'import {createDrizzleDatabase} from "./platform/database/drizzle-database.js";',
          ]
        : []),
      `import { problemResponse } from "${problemImportInIndex}";`,
      `import {applicationProblem} from "${relativeImport(entryPoint, posix.join(context.platformRoot, "http/application-error.ts"))}";`,
      ...(hasDrizzle
        ? [
            `import {createOperationBoundary} from "${relativeImport(entryPoint, posix.join(context.platformRoot, "application/access.ts"))}";`,
          ]
        : []),
      ...(hasDrizzle
        ? [
            `import { createRoutes } from "${routesImport}";`,
            `import { createRouteDependencies } from "${relativeImport(entryPoint, dependenciesFactoryPath)}";`,
          ]
        : [`import routes from "${routesImport}";`]),
      "",
      ...(hasAuthentication
        ? [
            `const app = new Hono<{ Bindings: AuthEnvironment${hasStorage ? " & StorageEnvironment" : ""} }>();`,
          ]
        : hasDrizzle
          ? [
              `const app = new Hono<{ Bindings: { DATABASE_URL: string;CORS_ALLOWED_ORIGINS?:string }${hasStorage ? " & StorageEnvironment" : ""} }>();`,
            ]
          : [
              `const app = new Hono<{Bindings:{CORS_ALLOWED_ORIGINS?:string}${hasStorage ? " & StorageEnvironment" : ""}}>();`,
            ]),
      "",
      "// Global RFC 7807 error handler",
      "app.onError((error, c) => {",
      "  const applicationError=applicationProblem(c,error);if(applicationError)return applicationError;",
      '  if (error instanceof HTTPException && error.status === 400) return problemResponse(c, 400, "Validation Failed", "Malformed request data");',
      '  return problemResponse(c, 500, "Internal Server Error", "An unexpected error occurred");',
      "});",
      "",
      "// Global RFC 7807 not found handler",
      "app.notFound((c) => {",
      '  return problemResponse(c, 404, "Not Found", `Route not found: ${c.req.path}`);',
      "});",
      "",
      'app.use("*",cors({',
      " origin:(origin,c)=>{",
      hasAuthentication
        ? "  return isTrustedAuthOrigin(origin,c.env)?origin:null;"
        : '  const allowed=c.env?.CORS_ALLOWED_ORIGINS;return origin && typeof allowed==="string" && allowed.split(",").map((value:string)=>value.trim()).includes(origin)?origin:null;',
      ' },allowHeaders:["Content-Type","Authorization","x-organization-id"],allowMethods:["GET","POST","PUT","PATCH","DELETE","OPTIONS"],credentials:true,maxAge:600,',
      "}));",
      ...(hasAuthentication
        ? [
            "// Better Auth owns credential, session, cookie, and CSRF handling.",
            ...(model.backend.ai ? ['app.route("/",createAiRoutes());'] : []),
            model.backend.ai?.mcp.enabled
              ? 'app.all("/api/auth/*", (c) => createAuth(c.req.header("x-nordix-mcp-gateway")==="1"?{...c.env,BETTER_AUTH_URL:new URL(c.env.MCP_PUBLIC_URL!).origin}:c.env,c.executionCtx).handler(c.req.raw));'
              : 'app.all("/api/auth/*", (c) => createAuth(c.env,c.executionCtx).handler(c.req.raw));',
            "",
          ]
        : []),
      ...(hasStorage
        ? [
            hasAuthentication
              ? 'app.route("/",createStorageRoutes<AuthEnvironment & StorageEnvironment>(async c=>{const session=await createAuth(c.env,c.executionCtx).api.getSession({headers:c.req.raw.headers});return session?(await createIamRepository(createDrizzleDatabase(c.env.DATABASE_URL)).principal(session.user.id)??null):null;},isTrustedAuthOrigin));'
              : 'app.route("/",createStorageRoutes<StorageEnvironment>(async()=>null,()=>false));',
          ]
        : []),
      ...(hasDrizzle
        ? [
            'app.all("*", async (c) => {',
            ...(hasAudit
              ? [
                  `const audit=beginBusinessAudit(c.req.raw,${JSON.stringify(modelAudit(context))},createAuditService(createAuditWriter(c.env.DATABASE_URL),c.executionCtx));`,
                ]
              : []),
            hasAuthentication
              ? `  const verifySession=async(headers:Headers)=>{const session=await createAuth(c.env,c.executionCtx).api.getSession({headers});${hasAudit ? 'audit.actor(session?.user.id??"anonymous");' : ""}return session?(await createIamRepository(createDrizzleDatabase(c.env.DATABASE_URL)).principal(session.user.id${context.identity?.organizations.enabled ? ',headers.get("x-organization-id")??(session.session as {activeOrganizationId?:string|null}).activeOrganizationId??undefined' : ""})??null):null;};let verified:ReturnType<typeof verifySession>|undefined;const boundary=createOperationBoundary(headers=>verified??=verifySession(headers)${hasAudit ? ",audit.capture" : ""});`
              : `  const boundary=createOperationBoundary(async()=>null${hasAudit ? ",audit.capture" : ""});`,
            `  const routes = createRoutes(createRouteDependencies(c.env.DATABASE_URL,boundary,c.req.raw.headers${hasStorage ? ",createStorage(c.env)" : ""}));`,
            ...(hasAudit
              ? [
                  "const response=await routes.fetch(c.req.raw,c.env,c.executionCtx);audit.finish(response.status);return response;",
                ]
              : ["  return routes.fetch(c.req.raw, c.env, c.executionCtx);"]),
            "});",
          ]
        : ['app.route("/", routes);']),
      "",
      "export default app;",
      "",
    ].join("\n"),
  });

  return files;
}

function modelAudit(context: BackendRenderContext) {
  return context.domainModel.endpoints
    .filter((operation) => operation.audit)
    .map((operation) => ({
      operationId: operation.operationId,
      method: operation.method,
      path: operation.path,
      resourceType: operation.entity.toLowerCase(),
      action: `${operation.entity.toLowerCase()}.${
        {
          create: "created",
          update: "updated",
          delete: "deleted",
          query: "read",
          custom: "executed",
        }[operation.action]
      }`,
    }));
}
