# Backend

Each backend is a Hono application deployed as a Cloudflare Worker. Its business modules run together in one process and share platform services.

## Configure a backend

This is a fragment of a project configuration:

```yaml
backends:
  - name: api
    repository: app
    path: apps/api
    persistence: { database: primary }
    modules:
      notes:
        architecture: clean
        entities: [Note]
```

Assign each entity to exactly one module. Add root [endpoints](../configuration/ENDPOINTS.md) to expose its operations. The entity declaration alone does not create CRUD routes.

## What is generated?

| Area | Includes |
| --- | --- |
| Business modules | Domain models, application operations, typed ports and adapters |
| HTTP | Hono routes, validated inputs, serialization and safe problem responses |
| Persistence | Drizzle tables, operation queries, migration/seed tooling |
| Identity | Better Auth sessions and IAM when authentication is configured |
| Platform | Composition, policy checks, database access, audit and enabled integrations |
| Operations | Worker configuration, local Docker runtime and deployment commands |

`src/modules/<name>/` holds module-owned code. `src/platform/` contains shared services. The backend composition supplies dependencies; modules do not discover private implementations at runtime.

## Optional capabilities

- [Authentication](AUTHENTICATION.md) and [roles](ROLES_PERMISSIONS.md).
- [Audit logging](AUDIT_LOGGING.md) for selected endpoints.
- [R2 storage](../INFRASTRUCTURE.md) through storage ports and management routes.
- [AI/MCP](AI.md) using the same application operations and permissions.

A persisted backend selects one dedicated database. Several modules may use it through their own adapters, but other backends cannot share that database resource. See [Project structure](../configuration/PROJECT_STRUCTURE.md).

## Architecture contracts

Choose an architecture per module:

| Family | Business code | Outer integrations |
| --- | --- | --- |
| Clean | `domain`, `application` use cases and ports | Infrastructure adapters and presentation controllers |
| Hexagonal | `core/domain`, `core/application` and inbound/outbound ports | Driving HTTP and driven persistence adapters |
| Onion | `domain`, application services/contracts/ports | Infrastructure HTTP and persistence adapters |

All families have the same operation semantics and [public module API](MODULE_COMMUNICATION.md). Domain/application code cannot import Hono, Drizzle or outer implementations. Type-only imports follow the same rule. Run generated `pnpm check:boundaries` after changes.

## Runtime rules

HTTP inputs are validated before business execution. Application operations also enforce their own permissions, including direct calls from another module. The backend verifies current sessions/grants; frontend controls are presentation only.

Persistence uses the Neon HTTP driver. Reusing a database client/schema within a Worker does not cache query results or permissions, create a transaction or guarantee a particular CPU budget. IAM administrative mutations use their own transactional path.

Cloud backends disable public and preview URLs. Frontends call through private Service Bindings. Local development uses explicitly configured internal URLs.

Next: [Modules](MODULES.md) · [Entities](../configuration/ENTITIES.md)
