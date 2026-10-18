# Direct fixed frontend generation

`generateFrontend(project, name)` consumes the resolved frontend and prepares all files in memory. Ordinary typed renderers produce the Next.js shell, existing native UI/styles, Tailwind, typed fetch transport, TanStack Query hooks, Zustand UI state, Better Auth integration and declared feature screens. Stack dependencies and known initial scaffold overlays are centralized in `generation/frontend.ts`.

The frontend registry, composer, descriptor/capability protocol, configurable library settings, plain-CSS selector, SWR, React Context alternate store and native-fetch-only screens are removed. Fetch remains the transport used by Query. One shell function owns providers/layout; feature renderers never emit either file. All output goes through the same guarded collection boundary as the backend. Known Next.js scaffold overlays are explicit and still require a new/empty destination.

Only declared operations feed clients, explorer and screen actions. There is no inferred CRUD route. Query loading/errors, filtering, pagination, form schemas and mutation invalidation remain in the fixed flow. Screens without a list operation have an explicit empty presentation state. Domain dates remain strings at the client boundary, with required nullable response properties.

Better Auth is the single reactive session source. Zustand contains UI notifications/modal state only; the session mirror and synchronization component have been removed. [Server page access](FRONTEND_ACCESS.md) uses the resolved public/authenticated/mixed inventory. [API clients, caches and forms](API_SCREENS.md) use resolved module operations, independent backend destinations, scoped invalidation and account isolation.

## Evidence

The required core/CLI suites cover functional generation, handlers, typed clients, forms/access metadata, absent operations, filters/pagination, cache isolation and shell ownership. Coverage gates remain unchanged and no exclusions are added. Obsolete registration, capability, library-selector and alternate-shell checks are removed with their production APIs.

A temporary application with real Next.js 15.5.26, React, Query, Zustand, Tailwind, forms and Better Auth dependencies completes a production `next build`. Protected pages are dynamic and auth entry pages remain public. Local browser acceptance against generated Hono/Better Auth and isolated PostgreSQL verifies login, protected page access, account state, logout and subsequent denial. Complete product acceptance remains RF-19 work.
