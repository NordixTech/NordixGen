# Direct fixed frontend generation

`generateFrontend(project, name)` consumes the resolved frontend and prepares all files in memory. Ordinary typed renderers produce the Next.js shell, existing native UI/styles, Tailwind, typed fetch transport, TanStack Query hooks, Zustand UI state, Better Auth integration and declared feature screens. Stack dependencies and known initial scaffold overlays are centralized in `generation/frontend.ts`.

The frontend registry, composer, descriptor/capability protocol, configurable library settings, plain-CSS selector, SWR, React Context alternate store and native-fetch-only screens are removed. Fetch remains the transport used by Query. One shell function owns providers/layout; feature renderers never emit either file. All output goes through the same guarded collection boundary as the backend. Known Next.js scaffold overlays are explicit and still require a new/empty destination.

Only declared operations feed clients, explorer and screen actions. There is no inferred CRUD route. Query loading/errors, filtering, pagination, form schemas and mutation invalidation remain in the fixed flow. Screens without a list operation have an explicit empty presentation state. Domain dates remain strings at the client boundary, with required nullable response properties.

The existing Better Auth UI/session view and its Zustand session mirror remain transitional until frontend-access consolidation (RF-15). They grant no backend authority. Module-qualified cache/screen consistency is refined separately in RF-16; this change does not invent those workflows or claim complete browser acceptance.

## Evidence

297 core tests and 17 CLI tests cover functional generation, handlers, typed clients, forms/access metadata, absent operations, filters/pagination and shell ownership. Coverage is 99.73% lines/statements, 98.01% branches and 100% functions, with unchanged gates and no exclusions. Obsolete registration, capability, library-selector and alternate-shell checks are removed with their production APIs.

A temporary application with real Next.js 15.5.26, React, Query, Zustand, Tailwind, forms and Better Auth dependencies completes a production `next build`: typed compilation and static pages for home, explorer, Note CRUD, sign-in and sign-up. This is build acceptance of actual generated source, not browser interaction or a persisted full-stack run. Those remain RF-19 acceptance work.
