import type { NordixIr } from '../../../core/ir/types.js';
import type { VirtualFileSystem } from '../../../core/vfs/index.js';
import { generateAuthCode } from './auth.js';
import { generateDrizzleClientCode, generateDrizzleSchemaCode } from './drizzle-schema.js';
import { generateEntityRouterCode } from './entity-crud.js';
import { generateErrorHandlerMiddlewareCode, generateErrorHandlingCode } from './error-handling.js';
import { generateLlmToolsCode } from './llm-tools.js';
import { generateSeedersCode } from './seeders.js';

export function generateHonoBackend(
  ir: NordixIr,
  vfs: VirtualFileSystem,
  basePath = 'apps/api',
): void {
  const prefix = basePath ? `${basePath}/` : '';

  // 1. package.json
  vfs.write(
    `${prefix}package.json`,
    JSON.stringify(
      {
        name: `${ir.projectName}-api`,
        version: '0.1.0',
        type: 'module',
        scripts: {
          dev: 'wrangler dev src/index.ts',
          deploy: 'wrangler deploy src/index.ts',
          'db:generate': 'drizzle-kit generate',
          'db:migrate': 'drizzle-kit migrate',
          'db:seed': 'tsx src/db/seed.ts',
          typecheck: 'tsc --noEmit',
        },
        dependencies: {
          '@hono/jwt': '^1.0.0',
          '@hono/zod-validator': '^0.4.3',
          '@neondatabase/serverless': '^0.10.4',
          'drizzle-orm': '^0.39.3',
          hono: '^4.7.2',
          zod: '^3.24.2',
        },
        devDependencies: {
          '@cloudflare/workers-types': '^4.20250214.0',
          '@faker-js/faker': '^9.5.0',
          '@types/node': '^22.13.5',
          dotenv: '^16.4.7',
          'drizzle-kit': '^0.30.4',
          tsx: '^4.19.3',
          typescript: '^5.7.3',
          wrangler: '^3.109.2',
        },
      },
      null,
      2,
    ),
  );

  // 2. tsconfig.json
  vfs.write(
    `${prefix}tsconfig.json`,
    JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          strict: true,
          skipLibCheck: true,
          types: ['@cloudflare/workers-types'],
        },
        include: ['src/**/*'],
      },
      null,
      2,
    ),
  );

  // 3. wrangler.jsonc
  vfs.write(
    `${prefix}wrangler.jsonc`,
    `{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "${ir.projectName}-api",
  "main": "src/index.ts",
  "compatibility_date": "2025-02-01",
  "compatibility_flags": ["nodejs_compat"],
  "vars": {
    "ENVIRONMENT": "development"
  }
}
`,
  );

  // 4. drizzle.config.ts
  vfs.write(
    `${prefix}drizzle.config.ts`,
    `import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL || '',
  },
});
`,
  );

  // 5. DB & Schema
  vfs.write(`${prefix}src/db/schema.ts`, generateDrizzleSchemaCode(ir));
  vfs.write(`${prefix}src/db/index.ts`, generateDrizzleClientCode());
  vfs.write(`${prefix}src/db/seed.ts`, generateSeedersCode(ir));

  // 6. Common errors & middleware
  vfs.write(`${prefix}src/common/errors.ts`, generateErrorHandlingCode());
  vfs.write(`${prefix}src/common/error-handler.ts`, generateErrorHandlerMiddlewareCode());

  // 7. Auth module
  if (ir.hasAuth) {
    vfs.write(`${prefix}src/modules/auth/index.ts`, generateAuthCode(ir));
  }

  // 8. Entity CRUD routers
  const entityRouterMounts: string[] = [];
  for (const entity of Object.values(ir.entities)) {
    const routerFileName = `${entity.tableName}.ts`;
    vfs.write(
      `${prefix}src/modules/${entity.tableName}/${routerFileName}`,
      generateEntityRouterCode(entity),
    );
    entityRouterMounts.push(
      `import { create${entity.name}Router } from './modules/${entity.tableName}/${entity.tableName}.js';`,
    );
  }

  // 9. LLM Agentic Tooling module
  if (ir.config.llm.enabled) {
    vfs.write(`${prefix}src/modules/agent/tools.ts`, generateLlmToolsCode(ir));
  }

  // 10. Main app entry point (src/index.ts)
  const mounts = Object.values(ir.entities)
    .map((e) => `app.route('/api/${e.tableName}', create${e.name}Router(db));`)
    .join('\n  ');

  vfs.write(
    `${prefix}src/index.ts`,
    `import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { createDb } from './db/index.js';
import { rfc7807ErrorHandler } from './common/error-handler.js';
${ir.hasAuth ? "import { createAuthRouter } from './modules/auth/index.js';" : ''}
${ir.config.llm.enabled ? "import { createAgentRouter } from './modules/agent/tools.js';" : ''}
${entityRouterMounts.join('\n')}

export interface Env {
  DATABASE_URL: string;
  JWT_SECRET?: string;
  ENVIRONMENT?: string;
}

const app = new Hono<{ Bindings: Env }>();

// Middlewares
app.use('*', logger());
app.use('*', cors());
app.onError(rfc7807ErrorHandler);

// Database middleware
app.use('*', async (c, next) => {
  const dbUrl = c.env?.DATABASE_URL || process.env.DATABASE_URL || '';
  c.set('db' as any, createDb(dbUrl));
  await next();
});

// Health check endpoint
app.get('/health', (c) => {
  return c.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: '${ir.projectName}-api',
  });
});

// API Routes
app.use('*', async (c, next) => {
  const db = c.get('db' as any);
  const jwtSecret = c.env?.JWT_SECRET || 'dev-secret-key-12345';

  ${ir.hasAuth ? "app.route('/api/auth', createAuthRouter(jwtSecret, db));" : ''}
  ${ir.config.llm.enabled ? "app.route('/api/agent', createAgentRouter(db));" : ''}
  ${mounts}

  await next();
});

export default app;
`,
  );
}
