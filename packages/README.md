# Packages Directory

Este directorio alberga los paquetes que componen la plataforma NordixGen bajo un monorepo administrado por `pnpm`:

- **`packages/core`**: Motor principal de NordixGen.
  - Esquemas de validación Zod (`nordix.config.yaml`).
  - Generador del Grafo Semántico (Nordix Intermediate Representation - IR).
  - Virtual File System (VFS) determinista y ordenamiento topológico.
  - Matriz de validación e incompatibilidades.

- **`packages/cli`**: Interfaz de línea de comandos ejecutable mediante `npx nordixgen`.
  - Prompts interactivos y formato de terminal (`@clack/prompts`, `commander`).
  - Orquestador de plantillas upstream (`create-next-app`, Cloudflare templates).
  - Comandos: `init`, `generate`, `validate`.

- **`packages/plugin-hono`**: Generador oficial para backend Hono (Clean Architecture en Cloudflare Workers).

- **`packages/plugin-nextjs`**: Generador oficial para frontend Next.js 15 (Tailwind v4, Feature-Driven, TanStack Query + Zustand).
