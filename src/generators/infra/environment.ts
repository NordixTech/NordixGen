import type { NordixIr } from '../../core/ir/types.js';
import type { VirtualFileSystem } from '../../core/vfs/index.js';
import { generateDockerComposeCode } from './docker.js';

export function generateInfraAndRoot(ir: NordixIr, vfs: VirtualFileSystem): void {
  const dbName = ir.projectName.replace(/-/g, '_');

  // 1. docker-compose.yml
  vfs.write('docker-compose.yml', generateDockerComposeCode(ir));

  // 2. .env.example
  vfs.write(
    '.env.example',
    `# Database Connection (Local Docker or Neon Serverless)
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/${dbName}"

# Authentication & Security
JWT_SECRET="replace-with-a-secure-random-secret-key-at-least-32-chars"

# Frontend Configuration
NEXT_PUBLIC_API_URL="http://localhost:8787"

# S3 / MinIO Almacenamiento Local (Cloudflare R2 en producción)
S3_ENDPOINT="http://localhost:9000"
S3_ACCESS_KEY="minioadmin"
S3_SECRET_KEY="minioadmin"
S3_BUCKET_NAME="uploads"
`,
  );

  // 3. .env (ready to run locally out of the box)
  vfs.write(
    '.env',
    `DATABASE_URL="postgresql://postgres:postgres@localhost:5432/${dbName}"
JWT_SECRET="dev-secret-nordix-key-2026"
NEXT_PUBLIC_API_URL="http://localhost:8787"
S3_ENDPOINT="http://localhost:9000"
S3_ACCESS_KEY="minioadmin"
S3_SECRET_KEY="minioadmin"
S3_BUCKET_NAME="uploads"
`,
  );

  // 4. pnpm-workspace.yaml (if monorepo)
  if (ir.config.structure === 'monorepo') {
    vfs.write(
      'pnpm-workspace.yaml',
      `packages:
  - 'apps/*'
  - 'packages/*'
`,
    );

    // Root package.json
    vfs.write(
      'package.json',
      JSON.stringify(
        {
          name: `${ir.projectName}-workspace`,
          version: '0.1.0',
          private: true,
          scripts: {
            'docker:up': 'docker compose up -d',
            'docker:down': 'docker compose down',
            dev: 'pnpm --parallel --filter "./apps/*" dev',
            'dev:api': 'pnpm --filter "./apps/api" dev',
            'dev:web': 'pnpm --filter "./apps/web" dev',
            'db:migrate': 'pnpm --filter "./apps/api" db:migrate',
            'db:seed': 'pnpm --filter "./apps/api" db:seed',
            build: 'pnpm --filter "./apps/*" build',
          },
        },
        null,
        2,
      ),
    );
  }

  // 5. .gitignore
  vfs.write(
    '.gitignore',
    `# Dependencies
node_modules/
.pnpm-store/

# Next.js build
.next/
out/

# Cloudflare Wrangler
.wrangler/
.mf/

# Drizzle migrations
drizzle/meta/

# Environment files
.env
.env*.local

# Logs
*.log
npm-debug.log*
yarn-debug.log*
pnpm-debug.log*

# OS and Editors
.DS_Store
Thumbs.db
.vscode/*
!.vscode/settings.json
!.vscode/extensions.json
`,
  );

  // 6. Project README.md
  vfs.write(
    'README.md',
    `# ${ir.projectName} ⚡

> Full-stack project generated with **NordixGen**. Built with Next.js, Tailwind CSS v4, Hono, Drizzle ORM, Neon PostgreSQL and Cloudflare Edge.

---

## 🚀 Quick Start (Running in 3 Steps)

### 1. Iniciar servicios locales (Docker Compose)
Levanta la base de datos PostgreSQL, Mailpit (previsualización de emails) y MinIO (S3 local):

\`\`\`bash
pnpm docker:up
\`\`\`

### 2. Ejecutar migraciones y sembrar datos de prueba (Seeders)
Puebla tu base de datos con registros realistas generados por Faker:

\`\`\`bash
pnpm db:migrate
pnpm db:seed
\`\`\`

### 3. Iniciar desarrollo en paralelo (Frontend + Backend)

\`\`\`bash
pnpm dev
\`\`\`

- **Frontend (Next.js):** [http://localhost:3000](http://localhost:3000)
- **Backend API (Hono):** [http://localhost:8787](http://localhost:8787)
- **Mailpit Web UI:** [http://localhost:8025](http://localhost:8025)
- **MinIO Console:** [http://localhost:9001](http://localhost:9001)

---

## 🤖 Módulo de Integración con LLM (Agentic Tooling)
La API expone automáticamente todos los casos de uso como herramientas para agentes inteligentes:
- **Catálogo de Herramientas:** \`GET http://localhost:8787/api/agent/tools\`
- **Ejecución de Herramientas:** \`POST http://localhost:8787/api/agent/execute\`

---

## ☁️ Despliegue en Cloudflare (Pages & Workers)

\`\`\`bash
# Desplegar API en Cloudflare Workers
pnpm --filter "./apps/api" deploy

# Desplegar Frontend en Cloudflare Pages
pnpm --filter "./apps/web" build
\`\`\`
`,
  );
}
