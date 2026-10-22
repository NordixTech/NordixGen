# Frontend

Each frontend is a Next.js App Router application with Tailwind CSS. It consumes the declared HTTP operations of its connected backends.

## Configure a frontend

```yaml
frontends:
  - name: web
    repository: app
    path: apps/web
    connectsTo: [api]
    access: { mode: public }
```

You can generate several frontends, each with its own connections, theme and access policy. A connection exposes typed API operations; it does not automatically grant the user access to them.

## What is generated?

- A responsive application shell and entity management pages.
- Typed fetch clients, TanStack Query hooks and API Explorer.
- Forms and actions when declared endpoints provide unambiguous bindings.
- Login/account UI when a connected identity authority is selected.
- Optional roles, audit, storage and AI interfaces for enabled backend capabilities.
- Light/Dark/System theme selection.

An entity management route is based on its name: `CustomerAddress` becomes `/customer-address`. An API Explorer is generated when connected endpoints exist. Missing operations are not replaced by invented CRUD routes.

## State and requests

TanStack Query owns remote records, caching and invalidation. Zustand owns UI state such as notifications, modals and theme. Better Auth owns reactive session state; do not add a separate session mirror or store tokens in localStorage.

Query identities include backend, module, operation, inputs and public/private account scope. Account, role or grant transitions clear the previous cache and cancel its requests. Mutations invalidate related declared reads on the same backend.

Initial list data can be read server-side with `no-store` and a request-specific query cache. The backend still authorizes the actual read. Browser query freshness is ten seconds; this is not permission caching or an authorization guarantee.

## Browser and server transport

Browsers call same-origin `/api/backend/<backend>` and `/api/auth` routes. The frontend Worker forwards to the correct private backend using a named Service Binding. There is no production public-backend fallback.

For host development, `.env.local` contains server-only `BACKEND_<NAME>_INTERNAL_URL` values. Docker uses its private bridge. Keep session-related local URLs on the same hostname.

Next: [Page access](PAGE_ACCESS.md) · [Forms and API clients](FORMS_CLIENTS.md) · [Themes](../configuration/THEMES.md)
