# Full-stack commerce example

Generate and explore a working commerce application from [project.yaml](project.yaml). This example shows how NordixGen turns a YAML configuration into a Next.js frontend and a Hono backend with business modules, persistence, authentication and permission-aware screens.

The same example is our maintained end-to-end check: every run generates a new project and verifies the resulting application with a real database and browser. The generated project is kept outside this source folder; you can inspect it, change it and use the YAML as a starting point for your own project.

The shared topbar includes Light/Dark/System theme controls, also available on forms, authentication, Explorer and IAM screens. The YAML demonstrates a complete custom light main palette with omitted semantic statuses, and a dark semantic override with the default main palette. Main colors must be all specified or all omitted independently in each mode. [Theme configuration and default colors](../../docs/configuration/YAML_V2.md#frontend-design-tokens-and-theme) explains the contract. The browser check exercises keyboard selection, persistence, system changes, cross-tab sync, unavailable storage and dark initialization before hydration; `verified-theme-light.png` and `verified-theme-dark.png` capture the generated result.

## What you will build

The application has two Clean modules in one backend:

- **Customers** owns Customer and CustomerAddress, including their persisted relationship. Customer browsing is public; mutations and protected lookups require permissions.
- **Billing** owns Invoice, with decimal amounts, JSON data, nullable values, dates and defaults. It imports the public `getCustomer` operation from Customers.

The frontend provides a workspace with links to its generated pages, Customer and Invoice screens, sign-in/sign-up, and an API Explorer. Invoice deletion and CustomerAddress endpoints are deliberately omitted: declaring a data model does not create extra operations.

## Quick start: generate, check and explore

Run the following from the **NordixGen repository root**. You need Node.js 24+, pnpm **10.5.2**, Git, Docker Engine running Linux containers, and internet access for application scaffolds and dependencies. The automated example supports Windows and Linux.

```bash
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm example:commerce --keep
```

On Linux, install Chromium's system dependencies with `pnpm exec playwright install --with-deps chromium` if needed.

The command builds NordixGen, validates the YAML, generates a fresh project, installs dependencies, compiles the frontend/backend, prepares an isolated database and demo accounts, and verifies the application. Only after every check passes does `--keep` leave the demo running.

At the end it prints the frontend URL and a run ID. Each run uses its own ports. Your project and review material are under:

```text
 tmp/examples/full-stack-commerce/<run-id>/
 ├── project/
 │   └── apps/
 │       ├── api/       # Generated backend and clearly identified example helpers
 │       └── web/       # Generated frontend
 ├── report.json
 ├── operation-artifacts.json
 ├── behaviors.json
 └── verified-*.png
```

The automated checks create, update and soft-delete sample records, so the retained demo shows the application after verification, rather than only its initial seed data.

## Explore the application

1. Open the printed frontend URL. The workspace links to Customer, Invoice and the API Explorer.
2. Open **Customer** without signing in. Inspect the records, filtering and pagination; use the Explorer to inspect the joined address data.
3. Open **Invoice**. The protected page takes you to sign-in.
4. Sign in as `admin@acceptance.example.test` with password `acceptance-local-password-2026`. Copy a Customer ID from Customer, then create and edit an Invoice. Try decimal amounts, JSON, dates and nullable fields; the list refreshes after saving. Invoice has no delete action because the YAML declares none.
5. Open **API Explorer**. Select an operation, read its field tables and send an authorized JSON request. Invalid input should produce a readable error.
6. Sign out and sign in as `outsider@acceptance.example.test`, using the same demo password. Protected records and mutations are unavailable. The Explorer explains why protected requests are disabled, while the public Customer list remains callable. Direct unauthorized API requests are also rejected by the backend.
7. Compare the YAML with the generated code in `project/apps/api/src/modules` and `project/apps/web/src`. `operation-artifacts.json` lists the eight declared application operations; no parallel entity-derived CRUD use cases or repositories are generated.

These accounts are disposable local demo identities:

| Account | What to explore |
|---|---|
| `admin@acceptance.example.test` | Customer and Invoice reads/writes |
| `viewer@acceptance.example.test` | Protected Customer reads and Invoice reads |
| `accountant@acceptance.example.test` | Invoice reads/writes, without permission for protected Customer lookup |
| `outsider@acceptance.example.test` | No business permissions; after successful verification, the custom `delegated-admin` role allows both IAM operations |

All four use `acceptance-local-password-2026`. The example creates users through the actual signup endpoint, verifies that callers cannot select an elevated role, and then provisions demo account assignments directly in its isolated database. Normal generated signup uses the configured default role; the generator seeds the role catalog but never login accounts. An administrator can manage roles and user assignments through the automatically generated `/admin/roles` screen and `/api/auth/iam/*` endpoints.

After verification, open `/admin/roles` with the admin or outsider account (use separate browser profiles). The outsider finishes with the custom `delegated-admin` role and both IAM permissions, while admin retains `*`. You can test:

- Removing outsider's administrative role as admin: review the warning, cancel or confirm, then inspect recent activity.
- Editing `delegated-admin` while signed in as outsider: removing either IAM permission warns that you are changing your own access. Removing the final IAM permission returns you to the workspace.
- Demoting one administrator, then attempting to demote the remaining one: the backend rejects the second change. Reassign another full administrator to proceed.

The demo verifies these cases automatically before leaving this baseline. The PostgreSQL integration suite also verifies simultaneous demotions, stale confirmations and audit-failure rollback. To restore an existing account if you change its role, use another administrator or the generated `auth:create-admin` command with this run's database environment.

Stop the running example when finished:

```bash
pnpm example:commerce --cleanup <run-id>
```

This stops only that run's owned processes and containers. The generated source, reports and screenshots remain available for inspection.

## Generate the YAML yourself, without the automated demo

You can use the public CLI directly instead of the managed demo command. From the repository root:

```bash
pnpm build
node packages/cli/dist/index.js validate -f examples/full-stack-commerce/project.yaml
node packages/cli/dist/index.js generate -f examples/full-stack-commerce/project.yaml -o ./tmp/my-commerce-project
```

Choose a new or empty output directory. Read the generated project's README, configure the backend's `.dev.vars` and frontend's `.env.local`, provide your own database connection, generate/apply migrations, and start the applications as described there. The YAML disables Git initialization and remote repository creation.

This path produces the ordinary generated application. Demo users, temporary Docker services, the Node example adapter and the authored workflow described below are provided by the automated example command, not by `nordixgen generate`.

To adapt the example, copy `project.yaml`, change the modules/entities/endpoints/access rules, then run the CLI against your copy. The automated verification is intentionally tied to the maintained commerce scenario; use the direct CLI for a different application.

## Features this example demonstrates and verifies

| Feature | What the example checks |
|---|---|
| YAML validation and generation | The current CLI validates and generates into a new directory on every run. |
| Modular Clean backend | Customers and Billing own their data and compile together with checked module boundaries. |
| Explicit operations | Use cases, query ports and adapters match the declared operation set exactly. Undeclared routes/actions and generic CRUD artifacts are absent. |
| Persistence | Real PostgreSQL migrations, deterministic business seeds, foreign keys and a persisted Customer/Address relation. |
| Data contracts | Decimal defaults and conversion, JSON values, nullability, dates, booleans and create/update defaults. |
| Queries and mutations | Filtering, pagination, declared joins, Customer soft deletion, frontend create/edit and mutation refetch. |
| Authentication | Actual credential signup/login and HttpOnly session cookies, with server-owned default roles. |
| Authorization | Public exceptions, successful permitted requests, missing identity 401, insufficient permissions 403, trusted-origin enforcement and rejected forged/expired/revoked identity. |
| Module communication | A clearly authored workflow uses generated public contracts and direct in-process calls, including caller/callee authorization and error propagation. |
| Theme | Light/Dark/System, persisted preferences, OS changes, cross-tab sync, keyboard access, blocked storage and pre-hydration initialization. |
| Frontend | Workspace navigation, public/private page boundaries, forms and Explorer on desktop/mobile, readable errors and permission feedback. |
| Account isolation | A denied account cannot see private records left by a previous account; session-scoped query caches are exercised. |
| Build and runtime | Strict generated TypeScript, production Next.js build, local Hono execution and a local bundle of the original Worker entry. |

This is a representative integrated example, not a claim that every configuration combination is exercised here. Other variants have focused core/CLI tests. It uses credential authentication; it does not demonstrate real external OAuth/email delivery or a cloud deployment. Hexagonal/Onion and automatic many-to-many generation remain unsupported readiness cases.

## How the example checks itself

Run without `--keep` for a disposable verification run:

```bash
pnpm example:commerce
```

CI runs the same command. A failed prerequisite, generation, build, database/browser assertion or cleanup produces a failed report and a nonzero exit; required stages are never silently skipped. Reports and screenshots are retained, while normal runs and failures stop their temporary services.

The source folder separates the configuration from its execution and verification helpers:

| File | Responsibility |
|---|---|
| [project.yaml](project.yaml) | User-editable configuration to generate the commerce application. |
| [scripts/run.mjs](scripts/run.mjs) | Builds NordixGen, invokes its public CLI, inventories output and coordinates the example checks. |
| [scripts/resources.mjs](scripts/resources.mjs) | Manages isolated ports, processes, Docker resources and ownership-checked cleanup. |
| [scripts/theme.mjs](scripts/theme.mjs) | Verifies the generated theme engine in Chromium, including pre-hydration initialization. |
| [scripts/verify.mjs](scripts/verify.mjs) | Exercises the real HTTP application and Chromium browser. |
| [scripts/runtime.ts](scripts/runtime.ts) | Example-only Node adapter and database/demo-account setup, copied beside the generated backend package. |
| [extensions/preview-customer.ts](extensions/preview-customer.ts) | Explicitly authored Billing workflow used to demonstrate the generated Customers public dependency. |

The generated application's identity, business handlers, composition and persistence code are imported unchanged. Browser network, database and session responses are not mocked. One check delays the actual session response to verify the pending-permission state. Another temporarily inserts a forbidden private-module import, requires the generated boundary checker to reject it, then removes it.

The runtime helper adds `/__acceptance/*` probes for module/context verification. These are example-only routes, not YAML-declared business endpoints. The preview extension is also authored example code: YAML imports generate contracts and wiring, not business decisions. Both additions are typechecked after generation, and the generated operation inventory is checked before they are copied.

Next.js runs its production build. The backend runs through the official Hono Node adapter for local verification; the original Cloudflare Worker entry also bundles through `wrangler deploy --dry-run`, without deployment. This example adapter does not add another generated deployment target.

## Output, database isolation and evidence

Each run creates its own PostgreSQL database, Docker network and Neon HTTP proxy with pinned images and ownership labels. The proxy receives a random localhost port; the example adapter forwards only that run's generated local Neon requests to it. External database destinations and credentials are not inherited.

Read `report.json` for the revision, artifact hashes, stages, results and URLs; `operation-artifacts.json` for the declared operation inventory; and `behaviors.json` for completed checks. Screenshots show the actual workspace, forms, Explorer and permission states. A failed stage remains failed even if earlier checks passed.

`state.json` contains disposable credentials and process/resource identifiers. Generated output stays under ignored `tmp/`; CI publishes only selected reports, screenshots and sanitized logs, excluding state, environment files, cookies and the database. Cleanup verifies process ownership and Docker labels before stopping resources. The generated project remains available after cleanup, but its disposable database does not.

The example enables `audit: true` on customer and invoice reads/writes. Open the **Activity** tab in `/admin/roles` as the administrator to filter authentication, IAM and business events and inspect before/after differences. Records are written asynchronously; use Refresh activity if a new event has not appeared yet.
