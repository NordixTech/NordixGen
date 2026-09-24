# NordixGen ⚡

> **Motor declarativo y determinista de generación de arquitectura y scaffolding para proyectos de software completos.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node: >=22.0.0](https://img.shields.io/badge/Node-%3E%3D22.0.0%20LTS-brightgreen.svg)](https://nodejs.org/)
[![Architecture: Decoupled](https://img.shields.io/badge/Architecture-Decoupled%20%26%20Modular-brightgreen.svg)](#arquitectura-y-desacoplamiento)
[![Engine: Deterministic](https://img.shields.io/badge/Generation-Algorithmic%20%28No%20LLM%20in%20Core%29-orange.svg)](#filosofía-de-generación)

---

## 📌 ¿Qué es NordixGen?

**NordixGen** es una plataforma y herramienta CLI diseñada para erradicar el trabajo repetitivo al arrancar proyectos de software. A partir de una única especificación declarativa en un archivo `YAML`, NordixGen construye la base completa de una aplicación (frontend, backend, persistencia, autenticación, infraestructura local y pipelines de despliegue), lista para compilar y ejecutar **a la primera**.

### Filosofía de Generación
1. **100% Algorítmico y Determinista:** El núcleo de generación no utiliza modelos de lenguaje (LLMs) para escribir el código fuente. Esto garantiza **reproducibilidad absoluta**, velocidad instantánea, cero alucinaciones de sintaxis y costo cero de ejecución.
2. **Asistencia de IA en la Capa Externa (Skill):** Los LLMs se aprovechan exclusivamente como asistente de diseño mediante una *Skill* que ayuda al desarrollador a modelar y redactar el archivo `YAML` de configuración a partir de requerimientos de negocio.
3. **Producción desde el Minuto Cero:** Un proyecto generado por NordixGen cuenta con la configuración mínima y rigurosa para desarrollo local con Docker, pruebas, validación de variables de entorno y despliegue continuo.

---

## 📦 Instalación y Uso

> [!NOTE]
> *(Sección reservada)*: Esta sección contendrá las instrucciones finales una vez publicado el primer release en el registro público de `npm`.

```bash
# Ejecución directa sin instalación previa (recomendado)
npx nordixgen init

# O instalación global vía npm
npm install -g nordixgen
```

---

## 🌟 The Golden Path (Ruta Dorada Oficial)

Para garantizar un código de nivel de producción sin sufrir el problema de la **explosión combinatoria** (mantener decenas de combinaciones de frameworks simultáneamente), el desarrollo de NordixGen centra su esfuerzo inicial en una **Ruta Dorada optimizada para máximo rendimiento y costo de nube $0 / ultra-bajo**:

* **Frontend:** **Next.js (App Router)** con **Tailwind CSS v4** (compilación nativa ultrarrápida con Lightning CSS, cero runtime overhead y diseño atómico preconfigurado).
* **Backend:** **Hono** (TypeScript) optimizado para **Cloudflare Workers** (arranque en frío de 0 ms, consumo mínimo de CPU <1 ms y latencia global en más de 300 ciudades).
* **Base de Datos:** **PostgreSQL en Neon** (Serverless Postgres con conexión pooling instantánea y branching gratuito).
* **ORM:** **Drizzle ORM** (Edge-native, bundle footprint <30 KB, cero dependencias pesadas de WASM o binarios, tipado estricto e inferido).
* **Almacenamiento de Archivos:** **Cloudflare R2** (Compatible con la API de AWS S3, con 10 GB gratis al mes y **$0 costo de transferencia / egress**).
* **Despliegue & Edge:** **Cloudflare Pages + Workers** (despliegue unificado con latencia mínima entre front y back).

---

## 🧩 Principio de Modularidad Extrema y Matriz de Incompatibilidad

NordixGen no es un generador rígido; está diseñado para ser una plataforma abierta y extensible:

1. **Desacoplamiento Front/Back por Contrato:**
   - La comunicación entre cualquier frontend y backend generado se rige por un **contrato formal agnóstico** (OpenAPI 3.1 / Schemas tipados).
   - Un frontend generado en Framework **X** puede conectarse de inmediato a un backend generado en Framework **Y** sin modificaciones estructurales en su lógica de consumo de API.
2. **Arquitectura de Plugins para la Comunidad:**
   - Nuevos contribuidores pueden agregar generadores para otros frameworks (`.NET`, `NestJS`, `Django`, `Angular`, `React Native`, etc.) simplemente implementando los contratos del motor central (`Nordix IR - Intermediate Representation`).
3. **Matriz de Incompatibilidad Explícita:**
   - El validador semántico analiza la combinación seleccionada antes de emitir archivos. Si una combinación presenta limitaciones técnicas (por ejemplo, un ORM no compatible con cierto backend o una configuración de despliegue no soportada), el CLI emite advertencias preventivas o errores detallados explicando la incompatibilidad.

---

## ⚙️ Integración con Herramientas Upstream y Control de Versiones

NordixGen no reinventa la rueda de los empaquetadores base:
- **Scaffolding Inteligente:** Puede orquestar y parametrizar las herramientas oficiales de los frameworks (como `create-next-app` o plantillas base curadas), inyectando de forma determinista la arquitectura limpia, capas de servicios y modelos.
- **Control Estricto de Versiones:** Trabaja siempre con las versiones más modernas y estables del ecosistema (Node.js 22+ LTS, TypeScript 5.5+, Next.js más reciente, Tailwind v4, Hono v4+).
- **Formatters y Linters Integrados:** Todo código generado se procesa con formateadores de alta velocidad (Biome / Prettier) para asegurar sintaxis impecable y estilo uniforme.

---

## 🚀 Características del Sistema

### 1. Modelado de Dominio y Persistencia
- **Entidades Ricas:** Atributos, tipos primitivos, enums y relaciones (`1:1`, `1:N`, `N:M`).
- **Políticas de Eliminación:** Configuración de cascadas (`CASCADE`, `SET NULL`) y soporte nativo para **Soft Delete** y auditoría (`createdAt`, `updatedAt`, `deletedAt`).
- **Seeders & Mock Data:** Generación automática de sembradores de base de datos con datos sintéticos realistas (`@faker-js/faker`) para poder interactuar con la aplicación inmediatamente.

### 2. Capa de API y Casos de Uso
- **Endpoints CRUD Estándar:** Generación de controladores, DTOs con validación estricta y casos de uso del dominio.
- **Endpoints Complejos:** Capacidad de definir consultas con agregaciones, JOINs y transacciones desacopladas en adaptadores de infraestructura.
- **Protección de Endpoints:** Autenticación (JWT, Refresh Tokens, OAuth con Google/GitHub), control de acceso basado en roles o permisos (RBAC / PBAC) y middlewares de seguridad.

### 3. Manejo Estandarizado de Errores (RFC 7807)
- Implementación del estándar **RFC 7807 (Problem Details for HTTP APIs)** en todos los backends generados.
- Catálogo de excepciones de dominio unificado: respuestas HTTP con estructura consistente, códigos de error legibles y trazabilidad de fallos sin exponer detalles sensibles de infraestructura.

### 4. Módulo de Integración con LLM (AI Agentic Tooling)
- Un módulo opcional integrado en la arquitectura del backend que mapea de forma introspectiva todos los **Casos de Uso** del sistema y los expone como herramientas ejecutables (*function calling / tool calling*).
- Permite que un agente inteligente o asistente LLM externo invoque acciones de la aplicación de manera estructurada, segura y auditada, respetando las mismas reglas de negocio y permisos del sistema.

### 5. Entorno Local de Desarrollo (Docker)
- Orquestación lista para correr con `docker compose`:
  - Motor de Base de Datos PostgreSQL local.
  - Servidor de correo ficticio local (**Mailpit**) para previsualizar flujos de verificación de cuenta y recuperación de contraseñas.
  - Emulador de almacenamiento de objetos S3 local (**MinIO**) para subida y procesamiento de archivos.
  - Servidor de caché en memoria (**Redis**) para sesiones o rate limiting.

### 6. Integración con Git y Versionamiento
- Inicialización automática del repositorio local (`git init`).
- Creación de `.gitignore` exhaustivo y calibrado según los frameworks elegidos.
- Configuración de estrategias de branching (**GitFlow** o **GitHub Flow**).
- Commit inicial semántico y estandarizado.

### 7. CI/CD y Documentación
- Flujos de trabajo automatizados en **GitHub Actions** para testing, linting y publicación a `npm` / `npx`.
- Infraestructura como Código (IaC) opcional y configuración de `wrangler.jsonc` para Cloudflare.
- Documentación viva autogenerada: Swagger / OpenAPI UI interactivo y manuales de arranque.

---

## 📄 Licencia

Distribuido bajo la licencia MIT. Consulta `LICENSE` para más información.
