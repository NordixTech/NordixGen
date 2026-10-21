# Direct fixed frontend generation

`generateFrontend(project, name)` consumes the resolved frontend and prepares all files in memory. Ordinary typed renderers produce the Next.js shell, existing native UI/styles, Tailwind, typed fetch transport, TanStack Query hooks, Zustand UI state, Better Auth integration and declared feature screens. Stack dependencies and known initial scaffold overlays are centralized in `generation/frontend.ts`.

The frontend registry, composer, descriptor/capability protocol, configurable library settings, plain-CSS selector, SWR, React Context alternate store and native-fetch-only screens are removed. Fetch remains the transport used by Query. One shell function owns providers/layout; feature renderers never emit either file. All output goes through the same guarded collection boundary as the backend. Known Next.js scaffold overlays are explicit and still require a new/empty destination.

Only declared operations feed clients, explorer and screen actions. There is no inferred CRUD route. Query loading/errors, filtering, pagination, form schemas and mutation invalidation remain in the fixed flow. Screens without a list operation have an explicit empty presentation state. Domain dates remain strings at the client boundary, with required nullable response properties.

Better Auth is the single reactive session source. Zustand contains notifications, modal and theme UI state; the session mirror and synchronization component have been removed. [Server page access](FRONTEND_ACCESS.md) uses the resolved public/authenticated/mixed inventory. [API clients, caches and forms](API_SCREENS.md) use resolved module operations, independent backend destinations, scoped invalidation and account isolation.

## Design tokens and theme state

The optional [frontend theme configuration](../configuration/YAML_V2.md#frontend-design-tokens-and-theme) is validated before generation and resolved once per frontend. Each light/dark main palette is either completely specified or completely defaulted; status overrides are independent and individually defaulted. Runtime and editor schema both publish the all-or-none main palette rule.

The styling renderer owns `src/styles/theme.css` and `app/globals.css`. Theme CSS defines light baseline tokens, explicit dark overrides and system dark media rules; `data-theme="light"` always overrides the OS. Source variables use `--ng-*`; public `--color-*` tokens and Tailwind v4 `@theme inline` aliases consume those values. Tokens cover brand and contrasting button text, surfaces, text, borders, error/success/warning/info with derived tints and foregrounds, focus, overlays and shadows. Native components, forms, Explorer and IAM administration share these tokens.

The sole root layout owns a shared topbar and a small synchronous inline head script that validates stored preference and sets `html.dataset.theme` before body rendering. HTML alone uses `suppressHydrationWarning` for this intentional pre-hydration attribute change. The theme store exposes `useTheme` with `theme`, `resolvedTheme` and `setTheme`. Shell initialization installs and cleans up media/storage listeners, follows OS changes only in System mode, synchronizes tabs and tolerates unavailable storage. It lives outside account-scoped Query providers. The generated UI remains server-renderable; client preference reconciliation does not change server/client initial markup.

## Evidence

The required core/CLI suites cover functional generation, handlers, typed clients, forms/access metadata, absent operations, filters/pagination, cache isolation and shell ownership. Coverage gates remain unchanged and no exclusions are added. Obsolete registration, capability, library-selector and alternate-shell checks are removed with their production APIs.

A temporary application with real Next.js 15.5.26, React, Query, Zustand, Tailwind, forms and Better Auth dependencies completes a production `next build`. Protected pages are dynamic and auth entry pages remain public. Local browser acceptance against generated Hono/Better Auth and isolated PostgreSQL verifies login, protected page access, account state, logout and subsequent denial. The integrated commerce example additionally covers the connected product.

Internal acceptance checks verify fresh CLI generation, compilation, PostgreSQL persistence, authorization and browser behavior. Run `pnpm test:acceptance`; isolated run artifacts are written under ignored `tmp/acceptance/commerce/`.
