import { posix } from "node:path";
import type { DomainModelContext, GeneratedFile, PluginContributionContext } from "../contracts.js";

function relativeImport(fromFile: string, toFile: string): string {
  let importPath = posix.relative(posix.dirname(fromFile), toFile).replace(/\.ts$/, ".js");
  if (!importPath.startsWith(".")) importPath = `./${importPath}`;
  return importPath;
}

function endpointTypeName(endpoint: DomainModelContext["endpoints"][number]): string {
  if (endpoint.operationId) {
    return endpoint.operationId.charAt(0).toUpperCase() + endpoint.operationId.slice(1);
  }
  const words = endpoint.path.split(/[^A-Za-z0-9]+/).filter(Boolean);
  const pathName = words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join("");
  return `${endpoint.method.charAt(0)}${endpoint.method.slice(1).toLowerCase()}${pathName || "Endpoint"}`;
}

function lowerFirst(value: string): string {
  return value.charAt(0).toLowerCase() + value.slice(1);
}

export function generateHonoFiles(context: PluginContributionContext): readonly GeneratedFile[] {
  const framework = context.framework;
  const architecture = context.architecture;
  const entryPoint = framework.entryPoints.worker;
  if (!entryPoint) {
    throw new Error('Hono framework context is missing the "worker" entry point.');
  }

  const controllerDirectory = posix.join(framework.codeRoot, architecture.directories.controller);
  const healthControllerPath = posix.join(controllerDirectory, "health.controller.ts");
  const routesPath = posix.join(controllerDirectory, "routes.ts");
  const hasAuthentication = context.availableCapabilities.has("authentication:better-auth");
  const hasDrizzle = context.availableCapabilities.has("orm:drizzle");
  const infrastructureDirectory = posix.join(
    framework.codeRoot,
    architecture.directories.infrastructure,
  );
  const authFilePath = posix.join(infrastructureDirectory, "auth/auth.ts");
  const authorizationPath = posix.join(infrastructureDirectory, "authorization/policy.ts");

  const model = context.domainModel;

  if (!model) {
    const healthImport = relativeImport(routesPath, healthControllerPath);
    const routesImport = relativeImport(entryPoint, routesPath);

    return [
      {
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
      },
      {
        path: routesPath,
        content: [
          'import { Hono } from "hono";',
          `import healthController from "${healthImport}";`,
          "",
          "const routes = new Hono();",
          'routes.route("/health", healthController);',
          "",
          "export default routes;",
          "",
        ].join("\n"),
      },
      {
        path: entryPoint,
        content: [
          'import { Hono } from "hono";',
          `import routes from "${routesImport}";`,
          "",
          "const app = new Hono();",
          'app.route("/", routes);',
          "",
          "export default app;",
          "",
        ].join("\n"),
      },
    ];
  }

  const problemDetailsPath = posix.join(framework.codeRoot, "presentation/problem-details.ts");
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
    `import healthController from "${relativeImport(routesPath, healthControllerPath)}";`,
    `import { problemResponse } from "${relativeImport(routesPath, problemDetailsPath)}";`,
  ];
  const routesRegistrations: string[] = ['  routes.route("/health", healthController);'];

  const useCaseDirectory = posix.join(framework.codeRoot, architecture.directories.useCase);
  const dtoDirectory = posix.join(useCaseDirectory, "dtos");

  // 3. Declared business endpoint controllers
  for (const endpoint of model.endpoints) {
    const operationName = endpointTypeName(endpoint);
    const controllerPath = posix.join(
      controllerDirectory,
      `${lowerFirst(operationName)}.controller.ts`,
    );
    const endpointDtoPath = posix.join(dtoDirectory, "endpoints", `${operationName}.dto.ts`);
    const endpointUseCasePath = posix.join(useCaseDirectory, `${operationName}.use-case.ts`);

    const problemImport = relativeImport(controllerPath, problemDetailsPath);
    const dtoImport = relativeImport(controllerPath, endpointDtoPath);
    const useCaseImport = relativeImport(controllerPath, endpointUseCasePath);

    const hasPathParams = endpoint.pathParams.length > 0;
    const hasQueryParams = endpoint.queryParams.length > 0 || endpoint.pagination !== undefined;
    const hasRequestBody = endpoint.requestBody !== undefined;
    const isSecured =
      endpoint.authRequired || endpoint.roles.length > 0 || endpoint.permissions.length > 0;
    const httpMethod = endpoint.method.toLowerCase();
    const honoPath = endpoint.path.replace(/\{([^{}]+)\}/g, ":$1");

    const dtoImportsList: string[] = [];
    if (hasPathParams) dtoImportsList.push("PathParamsSchema");
    if (hasQueryParams) dtoImportsList.push("QueryParamsSchema");
    if (hasRequestBody) dtoImportsList.push("RequestBodySchema");

    const validatorsList: string[] = [];
    const authorizationHandlers = isSecured
      ? [
          "    async (c, next) => {",
          "      const session = await createAuth(c.env as AuthEnvironment, c.executionCtx).api.getSession({ headers: c.req.raw.headers });",
          '      if (!session) return problemResponse(c, 401, "Unauthorized", "Authentication is required");',
          '      if (["POST", "PUT", "PATCH", "DELETE"].includes(c.req.method) && !isTrustedAuthOrigin(c.req.header("origin"), c.env as AuthEnvironment)) return problemResponse(c, 403, "Forbidden", "A trusted Origin header is required for state-changing requests");',
          ...(endpoint.roles.length > 0 || endpoint.permissions.length > 0
            ? [
                `      if (!isAuthorized(session.user, { roles: ${JSON.stringify(endpoint.roles)}, permissions: ${JSON.stringify(endpoint.permissions)} })) return problemResponse(c, 403, "Forbidden", "The authenticated user is not authorized for this operation");`,
              ]
            : []),
          "      await next();",
          "    },",
        ]
      : [];
    if (hasPathParams) {
      validatorsList.push(
        '    zValidator("param", PathParamsSchema, (result, c) => {',
        "      if (!result.success) {",
        '        return problemResponse(c, 400, "Validation Failed", "Invalid path parameters", result.error.issues);',
        "      }",
        "    }),",
      );
    }
    if (hasQueryParams) {
      validatorsList.push(
        '    zValidator("query", QueryParamsSchema, (result, c) => {',
        "      if (!result.success) {",
        '        return problemResponse(c, 400, "Validation Failed", "Invalid query parameters", result.error.issues);',
        "      }",
        "    }),",
      );
    }
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
            `import { createAuth, isTrustedAuthOrigin, type AuthEnvironment } from "${relativeImport(controllerPath, authFilePath)}";`,
          ]
        : []),
      ...(endpoint.roles.length > 0 || endpoint.permissions.length > 0
        ? [`import { isAuthorized } from "${relativeImport(controllerPath, authorizationPath)}";`]
        : []),
      `import { problemResponse } from "${problemImport}";`,
      ...(dtoImportsList.length > 0
        ? [`import { ${dtoImportsList.join(", ")} } from "${dtoImport}";`]
        : []),
      `import { ${operationName}UseCase } from "${useCaseImport}";`,
      "",
      `export interface ${operationName}ControllerDependencies {`,
      `  useCase?: ${operationName}UseCase;`,
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
      `      const query = ${hasQueryParams ? 'c.req.valid("query")' : "{}"};`,
      ...(hasRequestBody ? ['      const body = c.req.valid("json");'] : []),
      `      const rawInput = { path, query${hasRequestBody ? ", body" : ""} };`,
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
      '  routes.onError((err, c) => problemResponse(c, 500, "Internal Server Error", err.message));',
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
      'import { Hono } from "hono";',
      ...(hasAuthentication
        ? [
            'import { cors } from "hono/cors";',
            `import { createAuth, isTrustedAuthOrigin, type AuthEnvironment } from "${relativeImport(entryPoint, authFilePath)}";`,
          ]
        : []),
      `import { problemResponse } from "${problemImportInIndex}";`,
      ...(hasDrizzle
        ? [
            `import { createRoutes } from "${routesImport}";`,
            `import { createRouteDependencies } from "${relativeImport(entryPoint, dependenciesFactoryPath)}";`,
          ]
        : [`import routes from "${routesImport}";`]),
      "",
      ...(hasAuthentication
        ? ["const app = new Hono<{ Bindings: AuthEnvironment }>();"]
        : hasDrizzle
          ? ["const app = new Hono<{ Bindings: { DATABASE_URL: string } }>();"]
          : ["const app = new Hono();"]),
      "",
      "// Global RFC 7807 error handler",
      "app.onError((err, c) => {",
      '  return problemResponse(c, 500, "Internal Server Error", err.message);',
      "});",
      "",
      "// Global RFC 7807 not found handler",
      "app.notFound((c) => {",
      '  return problemResponse(c, 404, "Not Found", `Route not found: ${c.req.path}`);',
      "});",
      "",
      ...(hasAuthentication
        ? [
            'app.use("*", cors({',
            "  origin: (origin, c) => {",
            "    return isTrustedAuthOrigin(origin, c.env) ? origin : null;",
            "  },",
            '  allowHeaders: ["Content-Type", "Authorization"],',
            '  allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],',
            "  credentials: true,",
            "  maxAge: 600,",
            "}));",
            "",
            "// Better Auth owns credential, session, cookie, and CSRF handling.",
            'app.all("/api/auth/*", (c) => createAuth(c.env, c.executionCtx).handler(c.req.raw));',
            "",
          ]
        : []),
      ...(hasDrizzle
        ? [
            'app.all("*", (c) => {',
            "  const routes = createRoutes(createRouteDependencies(c.env.DATABASE_URL));",
            "  return routes.fetch(c.req.raw, c.env, c.executionCtx);",
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
