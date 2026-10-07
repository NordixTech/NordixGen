# NordixGen 🚀

> **Motor declarativo y determinista para la generación de proyectos full-stack empresariales.**  
> Diseña tu arquitectura, entidades, endpoints, autenticación y despliegue en un único archivo YAML. Genera código limpio, tipado y listo para producción sin alucinaciones de IA.

[![Node.js Version](https://img.shields.io/badge/node-%3E%3D24.0.0-brightgreen.svg)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Cloudflare Ready](https://img.shields.io/badge/Deploy-Cloudflare%20Edge-orange.svg)](https://cloudflare.com/)

---

## ⚡ ¿Qué es NordixGen?

**NordixGen** es un CLI y plataforma modular distribuida en `npm` (`@nordixgen/cli`, `@nordixgen/core`) orientada a eliminar el trabajo repetitivo de configuración y boilerplate al iniciar proyectos de software de gran escala.

A partir de un archivo declarativo `nordix.config.yaml`, NordixGen construye:
- **Clean Architecture** estricta en el Backend (Dominio, Casos de Uso, Puertos y Adaptadores).
- **Feature-Driven Architecture** en el Frontend (Next.js 15 App Router, Tailwind CSS v4).
- **Manejo de Estado Dual de Alto Rendimiento:** **TanStack Query v5** para caché remota y sincronización automática del servidor + **Zustand v5** para estado atómico de UI.
- **SDKs y Hooks Tipados End-to-End** generados automáticamente para cada entidad y endpoint.
- **Modelos y Esquemas ORM** con Drizzle ORM sobre PostgreSQL (Neon).
- **Authentication and Authorization:** Mature authentication libraries and standard identity protocols, with application-level role and permission checks (RBAC/PBAC).
- **CI/CD Nativo en el Edge con Cloudflare** (Workers Builds & Pages Git Integration) + Infraestructura como Código (Terraform/OpenTofu).
- **Entorno Local con Docker Compose:** PostgreSQL, Mailpit, MinIO y Redis en un solo comando.

---

## Scaffolding oficial de frameworks

NordixGen parte de las herramientas oficiales de cada framework para crear la estructura inicial, en vez de mantener copias propias que envejecen. `generate` coordina `create-next-app` para Next.js y Cloudflare C3 para Hono, les pasa opciones no interactivas y seguras, y después ensambla los repositorios definidos en el YAML. NordixGen personaliza el README generado y la portada del frontend con su identidad de producto; las entidades, endpoints y lógica de negocio se incorporarán en las fases de generación posteriores.

## Backend Generation

NordixGen composes **specialized plugins** instead of maintaining one monolithic generator for every technology combination. The core validates the configuration and coordinates generation; each plugin has a clear responsibility:

- **Architecture** decides which layers and paths contain entities, use cases, ports, adapters, and controllers. Clean and Hexagonal are separate strategies.
- **Framework** translates project specifications into framework conventions and language, such as Hono/TypeScript or .NET/C#. It also provides the code root, import conventions, and, where applicable, namespace rules.
- **ORM** generates concrete persistence code, such as Drizzle or Entity Framework, and declares the languages, databases, and runtimes it supports.
- **Database** identifies the storage engine and provider, such as PostgreSQL on Neon. Each backend selects its ORM and references the database it uses.

The framework provides project context; the architecture strategy resolves where each file role belongs in that context; and the framework and ORM plugins generate code at the resolved paths. Before writing files, NordixGen verifies that every plugin exists and that their capabilities are compatible. An unsupported combination, such as Hono with Entity Framework, produces a clear diagnostic instead of an incomplete project.

The first planned combination is Hono + Clean + Drizzle + PostgreSQL/Neon. The generator architecture allows additional strategies, frameworks, and ORMs without duplicating a generator for every combination. See [Phase 4](docs/IMPLEMENTATION_PLAN.md#phase-4-composable-backend-generation-golden-path) and the [detailed specification](docs/SPECIFICATION.md#modular-backend-generation-contract).

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

## 🏆 El Golden Path Oficial

NordixGen está diseñado de forma modular para que la comunidad pueda extenderlo a cualquier framework (.NET, NestJS, Django, Angular, etc.). Sin embargo, la **Ruta Dorada Oficial** de máxima eficiencia y coste cero o ultrabajo es:

| Capa | Tecnología Oficial | Justificación Técnica |
| :--- | :--- | :--- |
| **Frontend** | Next.js 15 (App Router) + Tailwind CSS v4 | Máximo rendimiento web, React Server Components, estilos ultra-ligeros con `@theme`. |
| **Frontend State** | TanStack Query v5 + Zustand v5 | Sincronización remota sin re-renders manuales + UI atómica sin boilerplate. |
| **Backend** | Hono (TypeScript) + Clean Architecture | Edge-native, 0 ms cold-starts en Cloudflare Workers, separación estricta de capas. |
| **Base de Datos** | PostgreSQL en Neon (Serverless) | Escalado automático a cero, branch de bases de datos por cada Pull Request. |
| **ORM** | Drizzle ORM | Bundle ultra-ligero (<30 KB), TypeScript nativo, queries relacionales ultrarrápidas. |
| **Aceleración DB**| Cloudflare Hyperdrive | Pooling y caché distribuida de consultas PostgreSQL en más de 300 ciudades. |
| **CI/CD** | Cloudflare Native Builds | Sin runners externos ni secretos en GitHub; builds en el Edge y Preview URLs automáticas. |
| **IaC** | Terraform / OpenTofu | Aprovisionamiento cloud completo (R2, Hyperdrive, Pages, Workers, DNS) con un solo comando. |
| **Desarrollo Local**| Docker Compose | Postgres 16, Mailpit (visualizador de emails), MinIO (compatible S3/R2) y Redis. |

---

## 📦 Modelo de Distribución y Uso

### 1. Ejecución Instantánea sin Instalación (Recomendado)
```bash
# Inicializar un archivo de configuración interactivo
npx nordixgen init

# Validar tu archivo YAML
npx nordixgen validate -f nordix.config.yaml

# Generar scaffolds base Next.js/Hono en el destino
npx nordixgen generate -f nordix.config.yaml -o ./mi-nuevo-proyecto

# Luego, instala las dependencias del workspace generado
cd ./mi-nuevo-proyecto
pnpm install
```

### 2. Instalación Global
```bash
npm install -g nordixgen
nordixgen generate -f nordix.config.yaml -o ./mi-nuevo-proyecto
```

---

> `generate` actualmente prepara scaffolds upstream de Next.js y Hono; la generación de entidades, endpoints, arquitectura de negocio y estado del frontend corresponde a las fases siguientes. La creación remota está disponible para GitHub y requiere GitHub CLI autenticado (`gh auth login`). Después de crear un remoto con Git inicializado, NordixGen verifica su URL y ejecuta `git push --dry-run` antes del primer push real.

## 🌿 Flujo de Trabajo Git y Publicación de Paquetes

NordixGen implementa un modelo de desarrollo profesional y publicación continua:

- **`main` (Distribución & Producción):** Cada commit o Pull Request fusionado en `main` activa de inmediato el workflow de CI/CD que compila, ejecuta pruebas y publica automáticamente `@nordixgen/cli` y `@nordixgen/core` al registro de `npm` con **npm Provenance (OIDC)** y el tag `@latest`.
- **`develop` (Integración):** Rama activa donde convergen todas las características probadas antes de hacer un release.
- **`feature/*`:** Ramas de trabajo aisladas para cada mejora o componente.

---

## 🛠️ Requisitos de Desarrollo

- **Node.js:** Versión `>= 24.0.0` (Active LTS).
- **Gestor de versiones recomendado:** [`fnm` (Fast Node Manager)](https://github.com/Schniz/fnm):
  ```bash
  fnm install 24
  fnm default 24
  fnm use 24
  ```
- **Gestor de paquetes:** `pnpm >= 10.0.0`.

---

## 📚 Documentación Técnica

- 📖 [Especificación Integral de Requisitos y Capacidades](docs/SPECIFICATION.md)
- 🗺️ [Plan de Implementación y Fases de Desarrollo](docs/IMPLEMENTATION_PLAN.md)
- 📦 [Arquitectura del Monorepo de Paquetes](packages/README.md)

---

## Project Language and Code Standards

- Source code, CLI output, identifiers, comments, commits, pull requests, issues, and all new or updated project documentation must be written in **English**.
- Conversations and collaboration may be in Spanish. Existing Spanish documentation will be translated incrementally during Phase 8; any documentation changed before then must still be written in English.

---

## 📄 Licencia

Este proyecto está bajo la Licencia [MIT](LICENSE).
