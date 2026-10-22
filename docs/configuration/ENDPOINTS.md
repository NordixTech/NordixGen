# Endpoints

Declare business HTTP operations under root `endpoints`. Each endpoint belongs to its entity's module. Its `operationId` must be unique within its backend.

The examples below extend the notes application from [Quick start](../GETTING_STARTED.md).

## Read and filter

```yaml
pagination:
  standard: { defaultPageSize: 25, maxPageSize: 100 }
endpoints:
  - backend: api
    entity: Note
    operationId: listNotes
    method: GET
    path: /api/notes
    queryParams:
      - name: title
        field: { entity: Note, field: title }
        required: false
        operator: contains
    pagination: standard
```

Call `/api/notes?title=meeting&page=1&pageSize=25`. Field-bound parameters filter stored data. Inline typed parameters are application arguments; they do not create SQL predicates automatically.

Operators are `eq` (default), `ne`, `in`, `gt`, `gte`, `lt`, `lte` and `contains`. `contains` supports strings; comparisons require numbers/dates. `in` uses repeated keys, such as `status=draft&status=active`. Other parameters reject repeated values. Unknown query keys are rejected, and JSON filtering is unsupported.

## Create

```yaml
endpoints:
  - backend: api
    entity: Note
    operationId: createNote
    method: POST
    path: /api/notes
    requestBody:
      useCase: { entity: Note, operation: create }
```

The body contains writable entity fields, for example `{ "title": "Meeting notes" }`. IDs and enabled timestamps are server-owned.

## Update or delete

```yaml
endpoints:
  - backend: api
    entity: Note
    operationId: updateNote
    method: PATCH
    path: /api/notes/{noteId}
    pathParams:
      - name: noteId
        field: { entity: Note, field: id }
    requestBody:
      useCase: { entity: Note, operation: update }
  - backend: api
    entity: Note
    operationId: deleteNote
    method: DELETE
    path: /api/notes/{noteId}
    pathParams:
      - name: noteId
        field: { entity: Note, field: id }
```

Update/delete require at least one required equality path/query binding to a main-entity field. This prevents an omitted filter from becoming an unbounded write. A nonunique equality filter can still affect several rows.

`PUT` and `PATCH` both use partial updates: omitted fields are preserved. Delete follows the entity's soft-delete setting. GET/DELETE bodies and mutation joins/pagination are not supported.

## Inputs and responses

Path placeholders use `{name}`, occupy a whole segment and require a matching path parameter. Paths cannot contain queries, fragments or trailing slashes except `/`. The same method with equivalent placeholders is a duplicate route.

A parameter has either `field: { entity, field }` or an inline `type`, never both. Query parameters default to required; path parameters are always required. Booleans use `true`/`false`, dates require timezone-bearing ISO values, and JSON query inputs contain encoded JSON text.

| Operation | Successful response |
| --- | --- |
| Unpaginated read/write | Array of rows; no match returns `[]` |
| Paginated GET | `{ items, total, page, pageSize }` |
| Joined operation | Rows shaped as `{ entity, joins }` |

Success uses HTTP 200. Dates serialize to UTC ISO strings; nullable fields remain present as null. Errors use problem details: validation 400, unauthorized 401, forbidden 403, authored not-found 404, conflict 409 and unexpected failure 500. Internal database/credential details are not returned.

## Pagination and joins

Pagination supports offset-based GET collections without path parameters. Defaults are `page=1`, page size 25 and maximum 100, with deterministic ID-ascending order. Customize profile `pageParam`, `pageSizeParam`, `defaultPageSize` and `maxPageSize`; parameter names cannot collide with operation inputs. Cursor pagination and an `orderBy` YAML key are not supported.

For a declared direct relation, add an explicit join to a GET endpoint:

```yaml
joins:
  - entity: Customer
    type: left
    fields: [name]
```

Join targets must be in the same module and have an unambiguous direct relation. `inner` excludes records without an active match; `left` retains them. Only selected fields are exposed; an omitted `fields` list exposes an empty projection. Collection absence is `[]`; a missing left to-one match is null. Pagination totals use the same filters/join existence rules.

## Access, audit and custom behavior

Use endpoint `permissions` for required capabilities and `audit: true` for activity capture. On an authenticated backend, login is required unless explicitly disabled with `authRequired: false`; a public endpoint cannot also require permissions.

An inline request body can declare typed fields or field references. On POST/PUT/PATCH it describes custom application input; it does not imply a create/update. Write business behavior in the generated application instead of assuming arbitrary body fields will be persisted.

Platform health, authentication, IAM and storage routes are generated separately. Do not redeclare their reserved paths as business endpoints.

Next: [Forms and API clients](../guides/FORMS_CLIENTS.md) · [Roles](../guides/ROLES_PERMISSIONS.md)
