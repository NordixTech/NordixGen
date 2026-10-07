# NordixGen: Plan de Implementación y Evolución Técnica

> **Roadmap Estratégico y Fases de Desarrollo.**  
> Este documento rige la descomposición en epics, issues y entregables verificables para la construcción de **NordixGen**. Cada fase representa un incremento de valor concreto, probado y comprobable.

---

## 🗺️ Resumen Ejecutivo de Fases

```mermaid
flowchart LR
    Fase1["Fase 1: Infra Monorepo & CI/CD NPM"] --> Fase2["Fase 2: Core Configuration & Intermediate Representation Engine"]
    Fase2 --> Fase3["Fase 3: Upstream Orchestrator & CLI"]
    Fase3 --> Fase4["Phase 4: Composable Backend Generation"]
    Fase4 --> Fase5["Fase 5: Plugin Next.js 15 & Dual-State"]
    Fase5 --> Fase6["Fase 6: Docker Local & Cloudflare IaC"]
    Fase6 --> Fase7["Fase 7: AI Agent Tools & E2E Validation"]
```

---

## 📌 Detalle de Fases, Tareas e Hitos Verificables

### 🚀 Fase 1: Cimientos del Monorepo, Tooling y Pipeline de Publicación NPM
**Objetivo:** Configurar la infraestructura del proyecto open-source con pnpm workspaces, Node.js 24 LTS, TypeScript 5.8+, Biome y el workflow automatizado de publicación continua a npm al fusionar en `main`.

- [ ] **1.1 Configuración de Monorepo & Workspaces:**
  - Estructuración de `packages/core` y `packages/cli`.
  - Configuración base de `tsconfig.json` compartido (ESM, NodeNext).
  - Configuración de linter y formateador ultrarrápido con `@biomejs/biome`.
- [ ] **1.2 Pipeline de Publicación Automática a NPM en `main`:**
  - Configurar GitHub Actions workflow `.github/workflows/release.yml`.
  - Integrar Changesets o Semantic Release para versionado semántico automático.
  - Publicación con **npm Provenance (OIDC tokenless)** para seguridad de la cadena de suministro.
  - Validación de compatibilidad con Node.js 24 (`engines: { "node": ">=24.0.0" }`).
- [ ] **1.3 Workflow de Integración Continua (CI) en PRs:**
  - Validación obligatoria en Pull Requests hacia `develop`: `lint`, `typecheck`, `test`.

*Criterio de Aceptación / Hito Verificable:*
- `pnpm build`, `pnpm lint` y `pnpm test` se ejecutan sin errores en los workspaces vacíos.
- El workflow de CI está listo para validar ramas de features.

---

### 🧠 Fase 2: Motor `@nordixgen/core` (Esquemas Zod, Representación Intermedia y Sistema de Archivos Virtual)
**Objetivo:** Crear el cerebro del generador, responsable de parsear el YAML, validar la coherencia del negocio, calcular dependencias topológicas y escribir en un sistema de archivos virtual antes de tocar el disco.

- [x] **2.1 Esquema Zod Exhaustivo (`nordix.config.yaml`):**
  - Definición de tipos de campos: `string`, `number`, `boolean`, `date`, `uuid`, `json`, `enum`.
  - Modificadores: `required`, `unique`, `default`, `description`.
  - Relaciones: `many-to-one`, `one-to-many`, `one-to-one`, `many-to-many`.
  - Soft-delete (`softDelete`), timestamps y políticas de cascada (`onDelete`).
  - Timestamps independientes (`createdAt`, `updatedAt`) y `deletedAt` cuando se habilita soft-delete.
  - Propiedad explícita de cada entidad y endpoint por backend.
  - Topología de organizaciones/repositorios; cada frontend/backend asignado a un repositorio.
  - Definición de endpoints CRUD y endpoints complejos con `joins`.
  - Múltiples conexiones frontend-backend (`connectsTo`); las conexiones vacías y backends sin consumidores son válidos.
  - Configuración de State Management (`client: zustand`, `server: tanstack-query`).
- [x] **2.2 Generador de JSON Schema:**
  - Script para emitir `nordix.schema.json` para auto-completado y validación en VSCode / IDEs con `# yaml-language-server`.
- [x] **2.3 Resolvedor del Grafo Semántico (Nordix Intermediate Representation):**
  - Normalización de datos sin ambigüedades.
  - Algoritmo de Kahn (ordenamiento topológico de entidades según dependencias de Foreign Keys) para migraciones y seeders sin deadlocks.
- [x] **2.4 Matriz de Validación de Compatibilidades:**
  - Detección de incompatibilidades declarativas y emisión de errores amigables antes de generar nada.
- [x] **2.5 Virtual File System Determinista:**
  - Sistema de árbol de archivos en memoria con operaciones idempotentes, orden de claves determinista y formateo automático.

*Criterio de Aceptación / Hito Verificable:*
- Tests unitarios con Vitest con 100% de cobertura de líneas, funciones, sentencias y ramas; incluye ciclos circulares, tipos inexistentes, errores de sintaxis y el ejemplo `examples/ecommerce.yaml`.

---

### 💻 Fase 3: Upstream Scaffolding Orchestrator & CLI `@nordixgen/cli`
**Objetivo:** Desarrollar el binario ejecutable `npx nordixgen` y la orquestación segura de generadores oficiales upstream.

- [ ] **3.1 Comandos del CLI con Commander & `@clack/prompts`:**
  - `nordixgen --version`: Valida versión de Node anfitriona (>=24) y versión de CLI.
  - `nordixgen validate -f <file.yaml>`: Valida la sintaxis y semántica sin escribir nada.
  - `nordixgen init`: Asistente interactivo en terminal para crear un `nordix.config.yaml` inicial.
  - `nordixgen generate -f <file.yaml> -o <targetDir>`: Orquestación completa de generación.
- [ ] **3.2 Upstream Scaffolder:**
  - Usar las herramientas upstream oficiales como fuente del scaffold: `create-next-app` para Next.js y el template `cloudflare-workers` de `create-hono` para Hono; NordixGen las orquesta con versiones y opciones controladas, sin mantener forks de sus plantillas.
  - Invocación no-interactiva de `create-next-app` o desempaquetado de plantilla canónica curada.
  - Invocación de templates base Cloudflare Workers (`npm create cloudflare`).
  - Ensamblaje del Monorepo con `pnpm-workspace.yaml` raíz y scripts `pnpm dev`.
  - Aplicar identidad NordixGen al README de cada repositorio generado y a la portada de cada frontend Next.js, preservando el contenido de referencia upstream cuando aporte instrucciones del framework.
  - **Preflight de repositorios remotos:** antes de generar archivos o crear remotos, comprobar la autenticación activa de GitHub CLI, verificar que la cuenta personal coincide con el handle configurado o que puede crear repositorios en la organización, y confirmar que el nombre remoto no esté ocupado.
  - Para repositorios inicializados, comprobar que Git tiene una identidad configurada; después de crear el remoto, verificar el URL y ejecutar `git push --dry-run` antes del primer push real. La autorización de push depende de reglas del repositorio nuevo y no puede comprobarse por completo antes de crearlo.
  - Si faltan credenciales o permisos, detenerse con instrucciones para corregir `gh auth login`, cambiar la cuenta activa o pedir acceso. Nunca guardar ni imprimir tokens. El primer adaptador remoto implementado es GitHub; GitLab y Bitbucket quedan pendientes.

*Criterio de Aceptación / Hito Verificable:*
- Al ejecutar `nordixgen validate examples/ecommerce.yaml` el CLI valida y muestra un resumen con spinner de Clack sin errores.
- El generador crea scaffolds upstream de Next.js 15 y Hono y ensambla los repositorios/workspaces definidos en `repositories`; Git init y creación remota son opt-in.
- Para `createRemote: true`, comprobar identidad y permiso de creación antes de la generación; comprobar URL e intentar `git push --dry-run` antes del primer push. El permiso de push no puede confirmarse por completo antes de crear un repositorio nuevo, porque depende de sus reglas.

---

### 🛡️ Phase 4: Composable Backend Generation (Golden Path)

**Objective:** Generate backends by composing independent architecture, framework, and persistence plugins. The initial Golden Path is Hono + Clean + Drizzle + PostgreSQL/Neon. The design must also support strategies such as Hexagonal/Onion, runtimes such as .NET/C#, and additional ORMs without duplicating a generator for every combination.

**Terminology:** A **plugin** is a registered, selectable extension (architecture, framework, or ORM). An architecture strategy such as Clean is implemented by an architecture plugin. The **generation engine** is the core coordinator that resolves and executes plugins. “Module” may describe internal files, but it is not the public extension contract.

#### Architecture decisions guiding the sub-issues

1. **Core/composer:** Receives the IR, resolves registered plugins, validates compatibility and capabilities, prepares the context, and coordinates VFS contributions. Unknown plugins, incompatible selections, uncovered capabilities, and path collisions fail before files are emitted; configuration is never silently ignored.
2. **Framework plugin:** Provides project context (language, application/code roots, scaffold, file/import conventions, entry points, runtime, and namespace rules). Hono/TypeScript and .NET/C# are different framework plugins.
3. **Architecture plugin:** Remains independent from a specific framework. It defines layers, allowed dependency directions, and semantic file locations (entity, use case, port, adapter, controller). It consumes framework context to resolve paths under `src/` or another code root without emitting framework-specific syntax.
4. **Generator plugins:** Framework and ORM consume the shared context and resolved `ArchitectureLayout`. The framework generates bootstrap/presentation code and derives imports/namespaces from final paths. The ORM generates schemas, repositories, and migrations in the persistence/infrastructure locations exposed by architecture.
5. **Declared-capability compatibility:** Plugins declare identity/version, provided capabilities, and requirements/constraints (language, runtime, framework, database). The resolver avoids a manually enumerated table of every permutation while allowing explicit restrictions. For example, Entity Framework must be rejected with Hono/TypeScript before generation.
6. **Persistence per backend:** `databases` describes resources; each backend can optionally select `persistence.database` and `persistence.orm`. There is no global ORM. Secrets and connection strings are configured outside YAML.

Target configuration:

```yaml
databases:
  commerce-db:
    engine: postgres
    provider: neon

backends:
  - name: core-api
    framework: hono
    architecture: clean
    persistence:
      database: commerce-db
      orm: drizzle
```

Backends without storage can omit `persistence`. Validation checks that database references exist and that the ORM supports the selected framework/runtime and database engine.

#### Sub-issues and deliverables (each is implemented in its own PR to `develop`)

The parent issue is [#5: Phase 4: Plugin Hono + Drizzle ORM (Golden Path Backend)](https://github.com/NordixTech/NordixGen/issues/5). Each sub-issue will be delivered in its own PR to `develop`; GitHub’s “blocked by” relationships track dependencies:

1. [#11 Plugin contracts, registry, and composer](https://github.com/NordixTech/NordixGen/issues/11): stable interfaces/versioning, `FrameworkContext`/`ArchitectureLayout`, registry, VFS contribution, capability requirements, and pre-generation compatibility errors.
2. [#12 Per-backend persistence in YAML and IR](https://github.com/NordixTech/NordixGen/issues/12): named `databases` resources and `backends[].persistence`, optional persistence, reference validation, and diagnostics.
3. [#13 Clean Architecture plugin](https://github.com/NordixTech/NordixGen/issues/13): semantic roles, layout, dependency direction, and framework-independent tests; prepare for Hexagonal/Onion strategies.
4. [#14 Hono framework plugin](https://github.com/NordixTech/NordixGen/issues/14): upstream scaffold, TypeScript/Hono context, code root and conventions; consume the layout for bootstrap and controllers.
5. [#15 Drizzle ORM plugin](https://github.com/NordixTech/NordixGen/issues/15): persistence for supported TypeScript/runtime/PostgreSQL-Neon combinations, with declared capabilities and constraints.
6. [#16 Domain entities and ports](https://github.com/NordixTech/NordixGen/issues/16): pure entities/enums and repository ports in Clean locations.
7. [#17 Application use cases and DTOs](https://github.com/NordixTech/NordixGen/issues/17): CRUD and declared operations, Zod DTOs, and join queries without Hono/Drizzle dependencies in domain/application.
8. [#18 Drizzle adapters](https://github.com/NordixTech/NordixGen/issues/18): schemas, relations, indexes, transactions, repositories, soft deletes, and declared joins.
9. [#19 Hono presentation](https://github.com/NordixTech/NordixGen/issues/19): routes/controllers, `@hono/zod-validator`, use-case dispatch, and RFC 7807 responses.
10. [#20 Migrations and seeders](https://github.com/NordixTech/NordixGen/issues/20): Drizzle Kit, reproducible scripts, and topological ordering for foreign keys and synthetic data.
11. [#21 Authentication and authorization](https://github.com/NordixTech/NordixGen/issues/21): evaluate a maintained library (Better Auth is the first self-hosted candidate), optional OIDC identity providers, secure browser sessions or standards-based API tokens, and application RBAC/PBAC. Do not implement authentication cryptography/protocols from scratch.
12. [#22 Golden Path integration and acceptance](https://github.com/NordixTech/NordixGen/issues/22): full generation from the example, install/build/typecheck, `wrangler dev`, CRUD, joins, soft delete, migrations, seeders, and authentication.

#### Phase acceptance criteria

- The Hono + Clean + Drizzle + PostgreSQL/Neon composition generates reproducibly, typechecks, and runs with `wrangler dev`.
- Architecture resolves every file role beneath the framework-declared code root; business files do not leak into the repository root. Imports and namespaces follow final paths.
- Unknown plugins and invalid combinations (for example, `framework: hono` with `orm: entity-framework`) fail before generation and name the missing plugin/capability.
- Any explicitly requested YAML capability not covered by a plugin is a blocking pre-generation error. Warnings are reserved for non-blocking recommendations.
- Authentication delegates credential hashing, OAuth/OIDC, session/token lifecycle, MFA, and recovery to a maintained library/provider; browser sessions use secure cookies, and app authorization is enforced by the backend.
- Clean, Hono, and Drizzle are tested as separate plugins; a new plugin can be registered through the documented contract without editing core.
- Every sub-issue is delivered in its own PR and tests its contract. The final sub-issue verifies the complete Golden Path.

---

### 🎨 Fase 5: Plugin Next.js 15 & Dual-State Management (Golden Path Frontend)
**Objetivo:** Generar interfaces reactivas con App Router, Tailwind CSS v4, Feature-Driven Architecture y el modelo de Estado Dual.

- [ ] **5.1 Configuración Base del Frontend:**
  - Tailwind CSS v4 con variables CSS y tema personalizable (`@theme`).
  - Componentes de UI atómicos accesibles (Botones, Inputs, Modales, Tablas, Badges, Toasts).
- [ ] **5.2 SDK Cliente API Tipado End-to-End (`@/services/<entity>.service.ts`):**
  - Wrapper tipado sobre Fetch nativo con interceptor para RFC 7807.
  - Métodos CRUD y endpoints complejos vinculados a cada backend en `connectsTo`.
- [ ] **5.3 Capa de Servidor React Query (`@/hooks/queries/`):**
  - Hooks reactivos de consulta (`use<Entity>Query`) con caching inteligente.
  - Mutaciones (`useCreate<Entity>Mutation`) con invalidación automática de consultas de lista.
  - Soporte de Mutaciones Optimistas configurables.
  - Los esquemas/consultas disponibles en cada frontend se derivan de las entidades de sus backends conectados; server-state mantiene cache e invalidación para evitar refetches repetidos.
- [ ] **5.4 Capa de Cliente Zustand (`@/stores/`):**
  - `authStore`: Almacenamiento seguro de tokens, sesión activa y verificación de permisos.
  - `uiStore`: Toasts, alertas y estado de interfaz.
- [ ] **5.5 Vistas Completas Feature-Driven por Entidad:**
  - Lista paginada con filtros y búsqueda.
  - Formularios de creación y edición con validación React Hook Form + Zod.
  - Modales de confirmación de eliminación (Soft Delete / Hard Delete).

*Criterio de Aceptación / Hito Verificable:*
- El frontend generado compila con `pnpm build`, se comunica con el backend Hono, y gestiona el estado sin errores de hidratación ni re-renders innecesarios.

---

### 🐳 Fase 6: Entorno Docker Local & Cloudflare Native CI/CD + IaC
**Objetivo:** Asegurar desarrollo local sin fricción y despliegue a producción en un clic.

- [ ] **6.1 Docker Compose Local (`docker-compose.yml`):**
  - PostgreSQL 16 Alpine con healthcheck.
  - Mailpit para captura y visualización de emails transaccionales.
  - MinIO para almacenamiento compatible con S3 / Cloudflare R2.
  - Redis 7 para colas y caché.
- [ ] **6.2 CI/CD Nativo en Cloudflare:**
  - Configuración de `wrangler.toml` por backend y directivas de Cloudflare Pages por frontend.
  - Script unificado de build con migraciones previas (`pnpm db:migrate && pnpm build`).
- [ ] **6.3 Infraestructura como Código (Terraform / OpenTofu):**
  - Módulos en `infra/terraform/` para provisionar: Cloudflare R2, Hyperdrive, Pages, Workers y DNS.

*Criterio de Aceptación / Hito Verificable:*
- `pnpm docker:up` levanta todos los servicios locales de inmediato y `terraform validate` es exitoso.

---

### 🤖 Fase 7: AI Agentic Tooling & Validación End-to-End (E2E)
**Objetivo:** Exponer la lógica de negocio para agentes de IA y validar el ciclo de vida completo de un proyecto de gran escala.

- [ ] **7.1 Endpoint de Herramientas para Agentes Inteligentes:**
  - `GET /api/agent/tools`: Catálogo JSON Schema de todos los casos de uso.
  - `POST /api/agent/execute`: Ejecución segura validada por Zod y auditada.
- [ ] **7.2 Suite de Pruebas E2E Automatizadas:**
  - Generación de un proyecto SaaS E-commerce completo a partir del archivo YAML más avanzado.
  - Verificación de compilación TypeScript en todos los frontends y backends generados.
  - Verificación de ejecución de tests unitarios del proyecto generado.

---

### 🌐 Fase 8: Revisión y Transición Total del Repositorio a Inglés (Open Source Readiness)
**Objetivo:** Asegurar que todo el código fuente, la documentación técnica y las salidas del CLI estén 100% en inglés estándar para la distribución global en npm y la comunidad open source.

- [ ] **8.1 Traducción Integral de Documentación Markdown:**
  - `README.md`
  - `docs/SPECIFICATION.md`
  - `docs/IMPLEMENTATION_PLAN.md`
  - `packages/README.md`
- [ ] **8.2 Auditoría de Código y Salidas:**
  - Nombres de interfaces, clases, funciones y variables en inglés.
  - Comentarios, docstrings y JSDocs en inglés.
  - Textos de ayuda y errores en la interfaz del CLI en inglés.
  - Mensajes de commits y changelogs en formato Conventional Commits en inglés.

---

## 📋 Mapeo con el Backlog de GitHub (Epic #39 en NordixCompass / NordixCore)

| Fase | Sub-Issue en GitHub | Size | Iteración |
| :--- | :--- | :--- | :--- |
| **Fase 1** | [#44: Phase 1: Monorepo Foundations, Tooling & NPM Continuous Release](https://github.com/NordixTech/NordixCore/issues/44) | M | Month-01 |
| **Fase 2** | [#45: Phase 2: Core Engine (@nordixgen/core) - Zod Schemas, IR Graph & Deterministic VFS](https://github.com/NordixTech/NordixCore/issues/45) | L | Month-01 |
| **Fase 3** | [#46: Phase 3: Upstream Scaffolding Orchestrator & CLI (@nordixgen/cli)](https://github.com/NordixTech/NordixCore/issues/46) | M | Month-01 |
| **Fase 4** | [#48: Phase 4: Plugin Hono + Drizzle ORM (Golden Path Backend)](https://github.com/NordixTech/NordixCore/issues/48) | XL | Month-01 |
| **Fase 5** | [#49: Phase 5: Plugin Next.js 15 & Dual-State Management (Golden Path Frontend)](https://github.com/NordixTech/NordixCore/issues/49) | XL | Month-01 |
| **Fase 6** | [#51: Phase 6: Local Docker Environment & Cloudflare Native CI/CD + IaC](https://github.com/NordixTech/NordixCore/issues/51) | L | Month-01 |
| **Fase 7** | [#52: Phase 7: AI Agentic Tooling & End-to-End Validation](https://github.com/NordixTech/NordixCore/issues/52) | M | Month-01 |
| **Fase 8** | [#54: Phase 8: Comprehensive English Localization & Documentation Review](https://github.com/NordixTech/NordixCore/issues/54) | S | Month-01 |
