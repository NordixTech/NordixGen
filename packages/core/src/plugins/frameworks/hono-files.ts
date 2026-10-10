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
  ];
  const routesRegistrations: string[] = ['  routes.route("/health", healthController);'];

  const useCaseDirectory = posix.join(framework.codeRoot, architecture.directories.useCase);
  const dtoDirectory = posix.join(useCaseDirectory, "dtos");

  // 3. Entity CRUD controllers
  for (const [entityName] of Object.entries(model.entities).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const controllerPath = posix.join(
      controllerDirectory,
      `${entityName.toLowerCase()}.controller.ts`,
    );
    const dtoPath = posix.join(dtoDirectory, `${entityName}.dto.ts`);
    const problemImport = relativeImport(controllerPath, problemDetailsPath);
    const dtoImport = relativeImport(controllerPath, dtoPath);

    const useCaseImports = [
      `import { Create${entityName}UseCase } from "${relativeImport(controllerPath, posix.join(useCaseDirectory, entityName, `create-${entityName.toLowerCase()}.use-case.ts`))}";`,
      `import { Get${entityName}UseCase } from "${relativeImport(controllerPath, posix.join(useCaseDirectory, entityName, `get-${entityName.toLowerCase()}.use-case.ts`))}";`,
      `import { List${entityName}UseCase } from "${relativeImport(controllerPath, posix.join(useCaseDirectory, entityName, `list-${entityName.toLowerCase()}.use-case.ts`))}";`,
      `import { Update${entityName}UseCase } from "${relativeImport(controllerPath, posix.join(useCaseDirectory, entityName, `update-${entityName.toLowerCase()}.use-case.ts`))}";`,
      `import { Delete${entityName}UseCase } from "${relativeImport(controllerPath, posix.join(useCaseDirectory, entityName, `delete-${entityName.toLowerCase()}.use-case.ts`))}";`,
    ];

    files.push({
      path: controllerPath,
      content: [
        'import { Hono } from "hono";',
        'import { zValidator } from "@hono/zod-validator";',
        'import { z } from "zod";',
        `import { problemResponse } from "${problemImport}";`,
        `import { Create${entityName}Schema, Update${entityName}Schema, ${entityName}IdSchema } from "${dtoImport}";`,
        ...useCaseImports,
        "",
        `export interface ${entityName}ControllerDependencies {`,
        `  createUseCase?: Create${entityName}UseCase;`,
        `  getUseCase?: Get${entityName}UseCase;`,
        `  listUseCase?: List${entityName}UseCase;`,
        `  updateUseCase?: Update${entityName}UseCase;`,
        `  deleteUseCase?: Delete${entityName}UseCase;`,
        "}",
        "",
        `export function create${entityName}Controller(deps?: ${entityName}ControllerDependencies): Hono {`,
        "  const router = new Hono();",
        "",
        "  router.post(",
        '    "/",',
        `    zValidator("json", Create${entityName}Schema, (result, c) => {`,
        "      if (!result.success) {",
        '        return problemResponse(c, 400, "Validation Failed", "Request body validation failed", result.error.issues);',
        "      }",
        "    }),",
        "    async (c) => {",
        '      const input = c.req.valid("json");',
        `      const useCase = deps?.createUseCase ?? (c.get("create${entityName}UseCase") as Create${entityName}UseCase | undefined);`,
        "      if (!useCase) {",
        `        return problemResponse(c, 500, "Internal Server Error", "Create${entityName}UseCase not configured");`,
        "      }",
        "      const entity = await useCase.execute(input);",
        "      return c.json(entity, 201);",
        "    },",
        "  );",
        "",
        "  router.get(",
        '    "/",',
        "    async (c) => {",
        `      const useCase = deps?.listUseCase ?? (c.get("list${entityName}UseCase") as List${entityName}UseCase | undefined);`,
        "      if (!useCase) {",
        `        return problemResponse(c, 500, "Internal Server Error", "List${entityName}UseCase not configured");`,
        "      }",
        "      const filter = c.req.query();",
        "      const result = await useCase.execute({ filter });",
        "      return c.json(result, 200);",
        "    },",
        "  );",
        "",
        "  router.get(",
        '    "/:id",',
        `    zValidator("param", z.object({ id: ${entityName}IdSchema }), (result, c) => {`,
        "      if (!result.success) {",
        '        return problemResponse(c, 400, "Validation Failed", "Invalid parameter: id", result.error.issues);',
        "      }",
        "    }),",
        "    async (c) => {",
        '      const { id } = c.req.valid("param");',
        `      const useCase = deps?.getUseCase ?? (c.get("get${entityName}UseCase") as Get${entityName}UseCase | undefined);`,
        "      if (!useCase) {",
        `        return problemResponse(c, 500, "Internal Server Error", "Get${entityName}UseCase not configured");`,
        "      }",
        "      const entity = await useCase.execute(id);",
        "      if (!entity) {",
        `        return problemResponse(c, 404, "Not Found", "${entityName} not found");`,
        "      }",
        "      return c.json(entity, 200);",
        "    },",
        "  );",
        "",
        "  router.patch(",
        '    "/:id",',
        `    zValidator("param", z.object({ id: ${entityName}IdSchema }), (result, c) => {`,
        "      if (!result.success) {",
        '        return problemResponse(c, 400, "Validation Failed", "Invalid parameter: id", result.error.issues);',
        "      }",
        "    }),",
        `    zValidator("json", Update${entityName}Schema, (result, c) => {`,
        "      if (!result.success) {",
        '        return problemResponse(c, 400, "Validation Failed", "Request body validation failed", result.error.issues);',
        "      }",
        "    }),",
        "    async (c) => {",
        '      const { id } = c.req.valid("param");',
        '      const changes = c.req.valid("json");',
        `      const useCase = deps?.updateUseCase ?? (c.get("update${entityName}UseCase") as Update${entityName}UseCase | undefined);`,
        "      if (!useCase) {",
        `        return problemResponse(c, 500, "Internal Server Error", "Update${entityName}UseCase not configured");`,
        "      }",
        "      const updated = await useCase.execute({ id, changes });",
        "      if (!updated) {",
        `        return problemResponse(c, 404, "Not Found", "${entityName} not found");`,
        "      }",
        "      return c.json(updated, 200);",
        "    },",
        "  );",
        "",
        "  router.delete(",
        '    "/:id",',
        `    zValidator("param", z.object({ id: ${entityName}IdSchema }), (result, c) => {`,
        "      if (!result.success) {",
        '        return problemResponse(c, 400, "Validation Failed", "Invalid parameter: id", result.error.issues);',
        "      }",
        "    }),",
        "    async (c) => {",
        '      const { id } = c.req.valid("param");',
        `      const useCase = deps?.deleteUseCase ?? (c.get("delete${entityName}UseCase") as Delete${entityName}UseCase | undefined);`,
        "      if (!useCase) {",
        `        return problemResponse(c, 500, "Internal Server Error", "Delete${entityName}UseCase not configured");`,
        "      }",
        "      await useCase.execute(id);",
        "      return c.body(null, 204);",
        "    },",
        "  );",
        "",
        "  return router;",
        "}",
        "",
        `export default create${entityName}Controller();`,
        "",
      ].join("\n"),
    });

    const routeVar = `${lowerFirst(entityName)}Controller`;
    routesImports.push(
      `import ${routeVar}, { create${entityName}Controller } from "${relativeImport(routesPath, controllerPath)}";`,
    );
    routesRegistrations.push(
      `  routes.route("/${entityName.toLowerCase()}s", deps?.entities?.${lowerFirst(entityName)} ? create${entityName}Controller(deps.entities.${lowerFirst(entityName)}) : ${routeVar});`,
    );
  }

  // 4. Custom endpoint controllers
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
    const httpMethod = endpoint.method.toLowerCase();
    const honoPath = endpoint.path.replace(/\{([^{}]+)\}/g, ":$1");

    const dtoImportsList: string[] = [];
    if (hasPathParams) dtoImportsList.push("PathParamsSchema");
    if (hasQueryParams) dtoImportsList.push("QueryParamsSchema");
    if (hasRequestBody) dtoImportsList.push("RequestBodySchema");

    const validatorsList: string[] = [];
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
      `export function create${operationName}Controller(deps?: ${operationName}ControllerDependencies): Hono {`,
      "  const router = new Hono();",
      "",
      `  router.${httpMethod}(`,
      `    ${JSON.stringify(honoPath)},`,
      ...validatorsList,
      "    async (c) => {",
      `      const useCase = deps?.useCase ?? (c.get("${lowerFirst(operationName)}UseCase") as ${operationName}UseCase | undefined);`,
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
      `export default create${operationName}Controller();`,
      "",
    ].join("\n");

    files.push({
      path: controllerPath,
      content: controllerContent,
    });

    const routeVar = `${lowerFirst(operationName)}Controller`;
    routesImports.push(
      `import ${routeVar}, { create${operationName}Controller } from "${relativeImport(routesPath, controllerPath)}";`,
    );
    routesRegistrations.push(
      `  routes.route("/", deps?.endpoints?.${lowerFirst(operationName)} ? create${operationName}Controller(deps.endpoints.${lowerFirst(operationName)}) : ${routeVar});`,
    );
  }

  // 5. Routes aggregator
  files.push({
    path: routesPath,
    content: [
      ...routesImports,
      "",
      "export interface RoutesDependencies {",
      "  entities?: Record<string, unknown>;",
      "  endpoints?: Record<string, unknown>;",
      "}",
      "",
      "export function createRoutes(deps?: RoutesDependencies): Hono {",
      "  const routes = new Hono();",
      ...routesRegistrations,
      "  return routes;",
      "}",
      "",
      "const routes = createRoutes();",
      "export default routes;",
      "",
    ].join("\n"),
  });

  // 6. Entrypoint with RFC 7807 error and notFound handlers
  const routesImport = relativeImport(entryPoint, routesPath);
  const problemImportInIndex = relativeImport(entryPoint, problemDetailsPath);

  files.push({
    path: entryPoint,
    content: [
      'import { Hono } from "hono";',
      `import { problemResponse } from "${problemImportInIndex}";`,
      `import routes from "${routesImport}";`,
      "",
      "const app = new Hono();",
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
      'app.route("/", routes);',
      "",
      "export default app;",
      "",
    ].join("\n"),
  });

  return files;
}
