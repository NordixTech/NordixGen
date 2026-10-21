# Welcome to NordixGen

NordixGen turns a YAML description of your application into a working TypeScript project. Define your data, API operations and access rules; generate the backend, web interface and deployment setup together.

Created by Nordix for building client applications, it handles the repetitive setup so you can start with business features. The generated source belongs to your project. You can edit it and run it without installing NordixGen in production.

## What you can build

- One or more Hono backends, organized into business modules.
- One or more Next.js frontends connected to those backends.
- PostgreSQL data models, typed APIs, forms and management screens.
- Authentication, database-managed roles, audit trails and document storage.
- Optional AI chat and MCP access to your business operations.
- Local Docker environments and Cloudflare staging/production deployments.

The stack is TypeScript, Next.js App Router, Tailwind CSS, Hono, Drizzle, PostgreSQL/Neon, Better Auth, TanStack Query and Zustand. You configure the application rather than choose frameworks.

## Start here

1. [Quick start](GETTING_STARTED.md) — generate and run a small application.
2. [Project structure](configuration/PROJECT_STRUCTURE.md) — organize repositories, backends and frontends.
3. [Backend](guides/BACKEND.md) and [frontend](guides/FRONTEND.md) — understand what is generated.

## Build your application

| Topic | What you will learn |
| --- | --- |
| [Entities](configuration/ENTITIES.md) | Fields, defaults, enums, timestamps and soft deletion |
| [Relations and indexes](configuration/RELATIONS_INDEXES.md) | Connect data and configure database indexes |
| [Endpoints](configuration/ENDPOINTS.md) | Reads, writes, filters, joins and pagination |
| [Modules](guides/MODULES.md) | Choose an architecture and organize business code |
| [Module communication](guides/MODULE_COMMUNICATION.md) | Call another module through typed contracts |
| [Authentication](guides/AUTHENTICATION.md) | Login, providers, password policies and delivery |
| [Roles and permissions](guides/ROLES_PERMISSIONS.md) | Configure grants and administer accounts |
| [Page access](guides/PAGE_ACCESS.md) | Public, private and mixed frontend pages |
| [Forms and API clients](guides/FORMS_CLIENTS.md) | Generated actions, validation and query state |
| [Themes](configuration/THEMES.md) | Colors and Light/Dark/System modes |
| [Audit logging](guides/AUDIT_LOGGING.md) | Record and inspect application activity |
| [AI and MCP](guides/AI.md) | Chat, external clients and custom tools |
| [Storage](INFRASTRUCTURE.md) | R2 buckets, uploads, downloads and infrastructure |

## Run and maintain

[Local development](guides/LOCAL_DEVELOPMENT.md) · [Deployment and CI/CD](DEPLOYMENT.md) · [Continue development](EXTENDING_PROJECTS.md) · [Troubleshooting](TROUBLESHOOTING.md)

## Reference

[YAML configuration](configuration/YAML_V2.md) · [Validation](configuration/VALIDATION.md) · [Core API](configuration/RESOLVED_MODEL.md) · [Contributing](CONTRIBUTING.md)
