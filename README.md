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
- **Seguridad y Autorización:** Web Crypto nativo, JWT, Refresh Tokens, y control granular de acceso basado en Roles y Permisos (RBAC/PBAC).
- **CI/CD Nativo en el Edge con Cloudflare** (Workers Builds & Pages Git Integration) + Infraestructura como Código (Terraform/OpenTofu).
- **Entorno Local con Docker Compose:** PostgreSQL, Mailpit, MinIO y Redis en un solo comando.

---

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

# Generar el proyecto completo en un monorepo
npx nordixgen generate -f nordix.config.yaml -o ./mi-nuevo-proyecto
```

### 2. Instalación Global
```bash
npm install -g nordixgen
nordixgen generate -f nordix.config.yaml
```

---

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

## 📄 Licencia

Este proyecto está bajo la Licencia [MIT](LICENSE).
