# YAML configuration reference

A configuration is a strict YAML v2 document. Use the guides for examples and this page to find supported keys/defaults. Unknown keys, duplicate keys, merge keys, custom tags and cyclic data are rejected. Defaults apply to omitted fields, not explicit null.

For editor completion, associate your YAML file with [nordix.schema.json](../../nordix.schema.json). The CLI also checks references and generation support that an editor schema alone cannot establish.

## Project

| Key | Default / requirement |
| --- | --- |
| `schemaVersion` | Required: `2` |
| `name` | Required project slug |
| `version` | Required `major.minor.patch`, optional prerelease suffix |
| `description` | Optional text |
| `organizations` | `[]`; items have `name`, GitHub `handle` |
| `repositories` | Required nonempty list |
| `databases` | `{}`; named resources with empty `{}` definitions |
| `backends` | Required nonempty list |
| `frontends` | `[]` |
| `entities` | Required nonempty map |
| `enums` | `{}`; names map to nonempty unique string lists |
| `endpoints` | `[]` |
| `pagination` | `{}`; named profiles |
| `iac` | Optional Cloudflare R2 configuration |

A minimal project starts like this; complete it with backend/entity declarations from [Quick start](../GETTING_STARTED.md):

```yaml
schemaVersion: 2
name: my-project
version: 1.0.0
repositories:
  - name: app
    path: .
```

## Naming and paths

Project, repository, database, application, module and role names use lowercase slugs starting with a letter, then letters/digits/hyphens. Entity, field, relation, enum, parameter and pagination names start with a letter and use letters/digits/underscores. Operation IDs use lower camel case and are unique per backend.

Entity names are project-global; module names are backend-local. Backend/frontend names share a namespace. References are case-sensitive. Generated symbol/path collisions are rejected, including case-insensitive filesystem collisions and reserved names.

Paths are relative and use `/`. Repository paths cannot overlap; application paths cannot overlap in the same repository. `.` is valid for an application occupying its repository root. See [Project structure](PROJECT_STRUCTURE.md).

## Repositories and applications

| Object | Supported keys |
| --- | --- |
| Repository | Required `name`, `path`; optional `organization`; `initializeGit: true` only; `createRemote: false`; `visibility: private` or `public` |
| Backend | Required `name`, `repository`, `path`, `modules`; optional `persistence`, `authentication`, `authorization`, `iac`, `ai` |
| Persistence | `{ database: <resource-name> }`; one dedicated database per persisted backend |
| Module | Required `architecture`, `entities`; `exports: []`; `imports: {}` |
| Frontend | Required `name`, `repository`, `path`; `connectsTo: []`; `access: { mode: public }`; optional `theme`, `ai` |

Architectures are `clean`, `hexagonal`, `onion`. Module imports map producer names to exported operation ID lists. Modules cannot be empty. See [Modules](../guides/MODULES.md) and [communication](../guides/MODULE_COMMUNICATION.md).

## Data

| Object | Supported keys |
| --- | --- |
| Entity | Required `backend`; optional `description`; `fields: {}`, `relations: {}`, `indexes: []`, `timestamps: { createdAt: false, updatedAt: false }`, `softDelete: false` |
| Field | Required `type`; `required: true`, `unique: false`; optional `description`, `default` and type-specific constraints |
| Relation | Required `type`, `target`; optional `foreignKey`, `joinTable`, `onDelete`, `description`; `required: false` |
| Index | `{ fields: [<field-names>] }`, 1–32 distinct columns |

Field types are `string`, `number`, `boolean`, `date`, `uuid`, `json`, `enum`. Strings accept min/max length; numbers accept `format`, `precision`, `scale`; enums require `enumName`. Date defaults accept a timezone-bearing ISO literal or `{ kind: now }`.

Relations support to-one/inverse shapes; many-to-many generation is unsupported. Relations/joins stay within a module. Soft deletion accepts `false`, `boolean` or `timestamp`. See [Entities](ENTITIES.md) and [Relations and indexes](RELATIONS_INDEXES.md).

## Operations

| Endpoint key | Default / requirement |
| --- | --- |
| `backend`, `entity`, `operationId`, `method`, `path` | Required |
| `summary` | Optional text |
| `pathParams`, `queryParams` | `[]` |
| `requestBody` | Optional inline fields/references or `{ useCase: { entity, operation: create \| update } }` |
| `joins` | `[]`; items have `entity`, `type: inner \| left`, `fields: []` |
| `pagination` | Optional named profile |
| `authRequired` | Inherits backend identity configuration |
| `permissions` | `[]`; all required |
| `audit` | Disabled when omitted |

Use `permissions`, not endpoint role restrictions. Nonempty endpoint `roles` is rejected.

A parameter requires `name` and exactly one of `field: { entity, field }` or inline `type`. `required` defaults to true; path parameters cannot be optional. Inline enums require `enumName`. Field-bound query `operator` defaults to `eq`.

Pagination defaults: `strategy: offset`, `pageParam: page`, `pageSizeParam: pageSize`, `defaultPageSize: 25`, `maxPageSize: 100`. Only GET collections without path parameters can paginate.

See [Endpoints](ENDPOINTS.md) for route syntax, filtering, response wrappers and mutation guards.

## Authentication and roles

| Authentication key | Default |
| --- | --- |
| `methods` | `[email-password]` |
| `identityProviders`, `features` | `[]` |
| `passwordPolicy` | 8–128 characters; complexity/numeric flags false |
| `session` | `{ expiresIn: 7d, updateAge: 1d }` |
| `allowedEmailDomains` | Unrestricted; if supplied, a nonempty exact-domain list |
| `rateLimit` | Enabled; IP 10/60s, account 10/15m |
| `smsOtp` | 10/day; cooldown 60s, multiplier 2, cap 15m |

Authentication omission disables identity; `{}` enables defaults. Durations accept positive seconds or integer `s`/`m`/`h`/`d` strings, bounded to 2147483647 seconds. Rate limiting accepts `ip: { window, max }`, `account: { window, max }`; top-level `window`/`max` configure IP limits unless `ip` is supplied.

Authorization requires `roles`, `adminRole`, `defaultRole`; `rolePermissions` defaults to `{}`. With identity and no authorization object, defaults are admin/user roles. See [Authentication](../guides/AUTHENTICATION.md) and [Roles](../guides/ROLES_PERMISSIONS.md).

## Frontend access and theme

`access` accepts `mode: public | authenticated | mixed`, optional identity `backend`, and `publicRoutes` only for mixed mode. Mixed mode requires a nonempty list. See [Page access](../guides/PAGE_ACCESS.md).

`theme` accepts `default: system | light | dark`, plus independent `light`/`dark` palettes. Each main palette is all-or-none; status colors default individually. See [Themes](THEMES.md).

## AI chat, tools and MCP

Backend `ai` accepts `enabled: true`, `mcp: { enabled: false, authMethods: [oauth, api-key] }` and `tools: { requireConfirmationOnMutations: true }`.

Frontend `ai` requires `backend`; `enabled` defaults true, `chat` defaults `{ enabled: false, placement: floating }`, and `connectPortal` defaults `{ enabled: false }`. Placement can be `page`. Only one backend per project can enable AI; it requires identity/persistence. See [AI and MCP](../guides/AI.md).

## Storage

Root `iac` accepts optional owner `repository` and `cloudflare.r2_storage`, a map of resource names to `{ visibility: private | public }`. Visibility defaults private. Backend `iac.r2_storage` lists consumed resource names. See [Storage](../INFRASTRUCTURE.md).

## Complete examples

[Small backend](../../examples/configuration/single-module.yaml) · [Mixed modules](../../examples/configuration/mixed-modules.yaml) · [Commerce](../../examples/full-stack-commerce/project.yaml) · [Larger application](../../examples/performance/project.yaml)

Use `validate` before generation; see [Validation](VALIDATION.md) for diagnostics.
