# Project structure

A configuration describes repositories, applications and business modules. You can place everything in one repository or split applications across repositories.

## One repository, several applications

These are configuration fragments; keep the entities and endpoints from your project.

```yaml
repositories:
  - name: app
    path: .
databases:
  primary: {}
backends:
  - name: api
    repository: app
    path: apps/api
    persistence: { database: primary }
    modules:
      catalog:
        architecture: clean
        entities: [Product]
frontends:
  - name: shop
    repository: app
    path: apps/shop
    connectsTo: [api]
  - name: admin
    repository: app
    path: apps/admin
    connectsTo: [api]
```

Both frontends consume the same API. Each receives its own screens, theme, access policy and build configuration.

## Separate repositories

Repository `path` is relative to the generation output. Application `path` is relative to its repository:

```yaml
repositories:
  - name: server
    path: server
  - name: client
    path: client
```

Assign the backend to `repository: server` and the frontend to `repository: client`. Use `path: .` for an application occupying its repository root, or a subdirectory for a workspace with several applications.

Repository paths cannot overlap or nest. Application paths cannot overlap or nest inside the same repository. Use relative paths with `/`, without `..`, absolute paths or symbolic-link escapes.

## Multiple backends

Add backend declarations with distinct names. A frontend's `connectsTo` may contain several backend names; its generated clients retain each destination separately.

Each persisted backend owns exactly one named database. Two backends cannot share a database resource, and one backend cannot select multiple databases. Use separate resources for separate backends, or put related modules in one backend when they need the same persistence scope.

```yaml
databases:
  commerce: {}
  reporting: {}
```

Select `persistence: { database: commerce }` on one backend and `persistence: { database: reporting }` on the other. These names identify resources; credentials are supplied at runtime.

A backend-only project is supported. A frontend-only configuration is not: at least one backend is required. Persistence may be omitted only when the selected features/operations do not require it. Authentication requires persistence.

## Identity across connections

A frontend uses one authenticated backend as its identity authority. With exactly one authenticated connection it is selected automatically. With several, set `access.backend` explicitly.

Secured browser operations must use that same authority. Public operations from other backends are allowed; cross-backend SSO is not generated. See [Page access](../guides/PAGE_ACCESS.md).

## Git and publication

Every repository initializes Git with `main` and `develop`. To create a remote, configure an organization alias and opt in:

```yaml
organizations:
  - name: nordix
    handle: NordixTech
repositories:
  - name: client-project
    path: .
    organization: nordix
    createRemote: true
    visibility: private
```

Remote creation requires authenticated GitHub CLI and a new repository name. Publication pushes both branches after local generation checks. Cloud setup happens separately through the generated deployment assistant.

Next: [Backend](../guides/BACKEND.md) · [Frontend](../guides/FRONTEND.md)
