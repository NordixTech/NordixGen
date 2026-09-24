# NordixGen ⚡

> **Motor declarativo y determinista de generación de arquitectura y scaffolding para proyectos de software completos.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Architecture: Decoupled](https://img.shields.io/badge/Architecture-Decoupled%20%26%20Modular-brightgreen.svg)](#arquitectura-y-desacoplamiento)
[![Engine: Deterministic](https://img.shields.io/badge/Generation-Algorithmic%20%28No%20LLM%20in%20Core%29-orange.svg)](#filosofía-de-generación)

---

## 📌 ¿Qué es NordixGen?

**NordixGen** es una plataforma y herramienta CLI diseñada para erradicar el trabajo repetitivo al arrancar proyectos de software. A partir de una única especificación declarativa en un archivo `YAML`, NordixGen construye la base completa de una aplicación (frontend, backend, persistencia, autenticación, infraestructura local y pipelines de despliegue), lista para compilar y ejecutar **a la primera**.

### Filosofía de Generación
1. **100% Algorítmico y Determinista:** El núcleo de generación no utiliza modelos de lenguaje (LLMs) para escribir el código fuente. Esto garantiza **reproducibilidad absoluta**, velocidad instantánea, cero alucinaciones de sintaxis y costo cero de ejecución.
2. **Asistencia de IA en la Capa Externa (Skill):** Los LLMs se aprovechan exclusivamente como interfaz de usuario / asistente de diseño mediante una *Skill* que ayuda al desarrollador a modelar y redactar el archivo `YAML` de configuración.
3. **Producción desde el Minuto Cero:** Un proyecto generado por NordixGen cuenta con la configuración mínima y rigurosa para desarrollo local con Docker, pruebas, validación de variables de entorno y despliegue continuo.

---

## 🎯 Objetivo del Sistema

Construir una herramienta modular y extensible que permita:
- Modelar dominios ricos (entidades, tipos, enums, relaciones y casos de uso) en un único contrato.
- Materializar arquitecturas limpias y mantenibles (Hexagonal, Clean Architecture, Feature-Driven).
- Generar aplicaciones desacopladas donde cualquier frontend pueda interoperar con cualquier backend.
- Evolucionar progresivamente a través de un roadmap incremental según el esfuerzo y adopción de la comunidad.

---

## 🌟 The Golden Path (Ruta Dorada)

Para maximizar el impacto y garantizar una calidad de código de nivel de producción sin sufrir el problema de la **explosión combinatoria** (mantener docenas de combinaciones de frameworks simultáneamente), el desarrollo de NordixGen se enfoca inicialmente en una **Ruta Dorada (Golden Path)**:

* **Frontend Principal:** *(⏳ Por definir)*
* **Backend Principal:** *(⏳ Por definir)*
* **Base de Datos / ORM Principal:** *(⏳ Por definir)*
* **Estrategia de Repositorio:** *(⏳ Por definir)*

> [!NOTE]
> La definición formal de este Golden Path se establecerá tras evaluar el balance óptimo entre rendimiento, facilidad de desarrollo y costos de infraestructura de despliegue (proveedores gratuitos / ultra-baratos).

### Extensibilidad para Nuevos Frameworks
El sistema está diseñado bajo un patrón de **adaptadores de generación**. Aunque el equipo de Nordix enfoque su esfuerzo inicial en el Golden Path, la arquitectura de NordixGen permite que cualquier desarrollador de la comunidad agregue generadores para nuevos frameworks (como `.NET`, `Django`, `Hono`, `NestJS`, `Angular`, `React Native`, etc.) simplemente implementando los contratos del motor central (`IR - Intermediate Representation`).

---

## 🧩 Principio de Modularidad Extrema y Advertencia de Incompatibilidades

La modularidad es una regla estricta en NordixGen:

1. **Desacoplamiento Front/Back por Contrato:**
   - La comunicación entre cualquier frontend y backend generado se rige por un **contrato formal agnóstico** (especificación OpenAPI 3.1 / Schemas tipados).
   - Un frontend generado en Framework **X** puede conectarse de inmediato a un backend generado en Framework **Y** sin modificaciones estructurales en su lógica de consumo de API.
2. **Matriz de Incompatibilidad Explícita:**
   - Cuando una combinación particular presente limitaciones técnicas (por ejemplo: un ORM específico no disponible en el lenguaje de un backend, o un tipo de arquitectura no aplicable a un frontend móvil), el CLI y el validador de NordixGen emitirán advertencias preventivas o errores de compatibilidad en tiempo de validación antes de generar archivos.

---

## 🚀 Características Principales

### 1. Modelado de Dominio y Persistencia
- **Entidades Ricas:** Atributos, tipos de datos primitivos, enums, relaciones (`1:1`, `1:N`, `N:M`).
- **Políticas de Eliminación:** Configuración de cascadas (`CASCADE`, `SET NULL`) y soporte nativo para **Soft Delete** y auditoría (`createdAt`, `updatedAt`, `deletedAt`).
- **Seeders & Mock Data:** Generación automática de sembradores de base de datos con datos sintéticos realistas (`faker`) para poder probar la aplicación inmediatamente tras levantar el entorno.

### 2. Capa de API y Casos de Uso
- **Endpoints CRUD Estándar:** Generación de controladores, DTOs con validación estricta y casos de uso del dominio.
- **Endpoints Complejos:** Capacidad de definir consultas con agregaciones, JOINs y transacciones desacopladas en adaptadores de infraestructura.
- **Protección de Endpoints:** Autenticación (JWT, Refresh Tokens, OAuth con Google/GitHub), control de acceso basado en roles o permisos (RBAC / PBAC) y middlewares de seguridad.

### 3. Manejo Estandarizado de Errores (Error Handling)
- Implementación del estándar **RFC 7807 (Problem Details for HTTP APIs)** en todos los backends generados.
- Catálogo de excepciones de dominio unificado: respuestas HTTP con estructura consistente, códigos de error legibles y trazabilidad de fallos sin exponer detalles sensibles de infraestructura.

### 4. Módulo de Integración con LLM (AI Agentic Tooling)
- Un módulo opcional integrado en la arquitectura del backend que mapea de forma introspectiva todos los **Casos de Uso** del sistema y los expone como herramientas ejecutables (*function calling / tool calling*).
- Permite que un agente inteligente o asistente LLM externo invoque acciones de la aplicación de manera estructurada, segura y auditada, respetando las mismas reglas de negocio y permisos del sistema.

### 5. Entorno Local de Desarrollo (Docker)
- Orquestación lista para correr con `docker compose`:
  - Motor de Base de Datos relacional o documental.
  - Servidor de correo ficticio local (**Mailpit**) para previsualizar flujos de verificación de cuenta y recuperación de contraseñas.
  - Emulador de almacenamiento de objetos S3 local (**MinIO**) para subida y procesamiento de archivos.
  - Servidor de caché en memoria (**Redis**) para sesiones, colas o rate limiting.

### 6. Integración con Git y Versionamiento
- Inicialización automática del repositorio local (`git init`).
- Creación de `.gitignore` exhaustivo y calibrado según los frameworks elegidos.
- Configuración de estrategias de branching (**GitFlow** o **GitHub Flow**).
- Commit inicial semántico y estandarizado.

### 7. CI/CD y Documentación
- Generación de flujos de trabajo de **GitHub Actions** (pruebas, linting, build, despliegue).
- Infraestructura como Código (IaC) opcional (Terraform).
- Documentación viva autogenerada: Swagger / OpenAPI UI interactivo, diagramas arquitectónicos y manuales de arranque.

---

## 🗺️ Roadmap de Evolución Progresiva

El desarrollo de NordixGen se organiza en fases incrementales:

- [ ] **Fase 1: Motor Central & Esquema Declarativo**
  - Definición del esquema `nordix.schema.json` y validador semántico.
  - CLI interactivo base (`npx nordixgen`).
  - Generador del Golden Path V1 (Full-stack básico con Docker local y Git init).
- [ ] **Fase 2: Dominio Avanzado, Seeders y RFC 7807**
  - Generación de seeders con Faker.
  - Manejador global de excepciones estandarizado.
  - Módulo base de integración con LLM para ejecución de casos de uso.
- [ ] **Fase 3: Multi-Framework & Arquitecturas Alternativas**
  - Desacoplamiento total del generador mediante plugins.
  - Incorporación de frameworks adicionales de back y front.
  - Validaciones de incompatibilidad en tiempo real.
- [ ] **Fase 4: Cloud & Despliegue Automatizado**
  - Generadores de IaC (Terraform) y presets para proveedores serverless / edge económicos.
  - Skill oficial de LLM para modelado de proyectos desde lenguaje natural.

---

## 📄 Licencia

Distribuido bajo la licencia MIT. Consulta `LICENSE` para más información.
