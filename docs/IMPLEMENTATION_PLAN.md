# NordixGen: Plan de Implementación y Evolución Técnica

> **Roadmap Estratégico y Fases de Desarrollo.**  
> Este documento rige la descomposición en epics, issues y entregables verificables para la construcción de **NordixGen**. Cada fase representa un incremento de valor concreto, probado y comprobable.

---

## 🗺️ Resumen Ejecutivo de Fases

```mermaid
flowchart LR
    Fase1["Fase 1: Infra Monorepo & CI/CD NPM"] --> Fase2["Fase 2: Core Configuration & Intermediate Representation Engine"]
    Fase2 --> Fase3["Fase 3: Upstream Orchestrator & CLI"]
    Fase3 --> Fase4["Fase 4: Composable Backend Generation"]
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
  - Usar las herramientas upstream oficiales como fuente del scaffold: `create-next-app` para Next.js y Cloudflare C3 para Hono; NordixGen las orquesta con versiones y opciones controladas, sin mantener forks de sus plantillas.
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

### 🛡️ Fase 4: Generación Backend Componible (Golden Path)

**Objetivo:** generar backends combinando plugins independientes de arquitectura, framework y persistencia. El Golden Path inicial será Hono + Clean + Drizzle + PostgreSQL/Neon, pero el diseño debe admitir arquitecturas como Hexagonal/Onion, runtimes como .NET/C# y otros ORMs sin copiar un generador para cada combinación.

**Terminología:** llamamos **plugin** a la unidad extensible registrada y seleccionable (arquitectura, framework o ORM). Una **estrategia de arquitectura** como Clean es implementada por un plugin de arquitectura. **Motor de generación** es el coordinador del core que resuelve y ejecuta plugins. «Módulo» puede describir archivos internos, pero no es el nombre de la extensión pública.

#### Acuerdos de arquitectura que guían todas las sub-issues

1. **Core/compositor:** recibe la IR, resuelve plugins registrados, valida compatibilidad/capacidades, coordina el contexto y contribuciones al VFS. Rechaza plugins desconocidos, combinaciones incompatibles, capacidades no cubiertas y colisiones de ruta antes de emitir archivos; nunca omite configuración silenciosamente.
2. **Plugin de framework:** establece el contexto del proyecto (lenguaje, raíz de aplicación/código, scaffold, extensiones, imports, entrada, runtime y reglas de namespace). Hono/TypeScript y .NET/C# son plugins diferentes.
3. **Plugin de arquitectura:** independiente del framework, define capas, dependencias permitidas y un mapa de ubicaciones por rol (entidad, caso de uso, puerto, adaptador, controlador). Recibe el contexto del framework para resolver las rutas dentro de `src/` u otra raíz, sin emitir sintaxis propia de un framework.
4. **Plugins generadores:** framework y ORM consumen el contexto y `ArchitectureLayout` resuelto. Framework genera el código de presentación/arranque y calcula imports/namespaces con las rutas finales; ORM genera esquemas, repositorios y migraciones en el espacio de persistencia/infraestructura que expone la arquitectura.
5. **Compatibilidad por capacidades declaradas:** plugins declaran identidad/versionado, capacidades que proveen y requisitos/restricciones (lenguaje, runtime, framework, base de datos). El resolver evita una tabla manual de todas las permutaciones, pero permite restricciones explícitas. Por ejemplo, Entity Framework debe fallar con Hono/TypeScript antes de generar.
6. **Persistencia por backend:** `databases` describe recursos; cada backend puede opcionalmente seleccionar `persistence.database` y `persistence.orm`. No hay un ORM global. Secretos/conexiones se resuelven fuera del YAML.

Configuración objetivo:

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

Un backend sin persistencia puede omitir `persistence`. La validación debe comprobar que las referencias de base de datos existan y que el ORM sea compatible con el framework/runtime y motor elegidos.

#### Sub-issues y entregas (cada una se desarrolla en su propio PR a `develop`)

La issue padre es [#5: Phase 4: Plugin Hono + Drizzle ORM (Golden Path Backend)](https://github.com/NordixTech/NordixGen/issues/5). Cada sub-issue se implementará en su propio PR a `develop`; las relaciones «blocked by» de GitHub reflejan las dependencias:

1. [#11 Contrato de plugins, registro y compositor](https://github.com/NordixTech/NordixGen/issues/11): interfaz/versionado estable, tipos `FrameworkContext`/`ArchitectureLayout`, registro, contribución VFS, requisitos/capacidades y errores de incompatibilidad antes de escribir.
2. [#12 Persistencia por backend en YAML e IR](https://github.com/NordixTech/NordixGen/issues/12): recursos `databases` y `backends[].persistence`; persistencia opcional; validar referencias y diagnósticos.
3. [#13 Plugin de arquitectura Clean](https://github.com/NordixTech/NordixGen/issues/13): roles, layout, dirección de dependencias y pruebas independientes del framework; preparar la adición futura de Hexagonal/Onion.
4. [#14 Plugin framework Hono](https://github.com/NordixTech/NordixGen/issues/14): scaffold upstream, contexto TypeScript/Hono, raíz de código y convenciones; consumir layout para arranque y controladores.
5. [#15 Plugin ORM Drizzle](https://github.com/NordixTech/NordixGen/issues/15): persistencia compatible con TypeScript/runtime/PostgreSQL-Neon y capacidades/restricciones registradas.
6. [#16 Generación de dominio y puertos](https://github.com/NordixTech/NordixGen/issues/16): entidades/enums puros y puertos de repositorio en las ubicaciones de Clean.
7. [#17 Casos de uso y DTOs](https://github.com/NordixTech/NordixGen/issues/17): CRUD y operaciones declaradas, DTOs Zod y consultas/joins sin dependencias de Hono o Drizzle en dominio/aplicación.
8. [#18 Adaptadores Drizzle](https://github.com/NordixTech/NordixGen/issues/18): esquemas, relaciones, índices, transacciones, repositorios, soft delete y joins declarados.
9. [#19 Presentación Hono](https://github.com/NordixTech/NordixGen/issues/19): rutas/controladores, validación `@hono/zod-validator`, casos de uso y respuestas RFC 7807.
10. [#20 Migraciones y seeders](https://github.com/NordixTech/NordixGen/issues/20): Drizzle Kit, scripts reproducibles y orden topológico para foreign keys y datos sintéticos.
11. [#21 Autenticación y autorización](https://github.com/NordixTech/NordixGen/issues/21): Web Crypto, PBKDF2/SHA-256, JWT, refresh tokens, RBAC/PBAC y protección de endpoints.
12. [#22 Integración y aceptación del Golden Path](https://github.com/NordixTech/NordixGen/issues/22): generación completa desde el ejemplo, instalación/build/typecheck, `wrangler dev`, CRUD, joins, soft delete, migraciones, seeders y autenticación.

#### Criterios de aceptación de la fase

- La composición Hono + Clean + Drizzle + PostgreSQL/Neon genera una aplicación reproducible y determinista, compila sin errores y corre en `wrangler dev`.
- La arquitectura resuelve todos los roles bajo la raíz de código que declara el framework; ningún archivo de negocio acaba accidentalmente en la raíz del repositorio. Imports y namespaces derivan de las rutas finales.
- Plugins desconocidos y pares inválidos (p. ej. `framework: hono` + `orm: entity-framework`) fallan antes de generar, con el plugin o capacidad faltante nombrado.
- Cualquier capacidad solicitada explícitamente en YAML y no cubierta por un plugin causa un error bloqueante antes de generar; las advertencias se reservan para recomendaciones que no cambian el resultado declarado.
- Clean, Hono y Drizzle se prueban como plugins con límites separados; un plugin nuevo puede registrarse mediante contrato documentado sin editar el core.
- Cada sub-issue se completa en su PR, incluye tests de su contrato y señala las pruebas del proyecto generado que habilita. La sub-issue final verifica el Golden Path entero.

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
