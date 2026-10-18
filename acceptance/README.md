# Fresh generated application acceptance

This is the maintained integration check for the current fixed-stack product. It generates new output every run. It is not a snapshot baseline or a conversion of historical examples. Run it again after repository cleanup.

## Prerequisites and commands

- A Windows or Linux runner, Node.js 24+, pnpm **10.5.2**, Git, working Docker Engine with Linux containers, internet access for the pinned official Hono/Next scaffolders, npm packages and pinned test images.
- From the repository root: `pnpm install --frozen-lockfile`, then `pnpm exec playwright install chromium`. Linux machines may need `pnpm exec playwright install --with-deps chromium`.
- Run **`pnpm acceptance`**. It builds core/CLI itself, validates the fixture and invokes the public compiled CLI into a new `tmp/acceptance/<run-id>/project`. It never reuses a previously generated application.
- Run **`pnpm acceptance --keep`** to retain the running applications and disposable database **only after complete success**, for manual review.
- Stop retained resources with **`pnpm acceptance --cleanup <run-id>`**. Cleanup verifies process command lines and Docker resource ownership labels before stopping/removing this run's resources. Generated files/reports remain available for inspection.

Missing prerequisites, build/HTTP/browser assertion failures and cleanup failures produce a nonzero exit and a failed report. Database/browser stages are mandatory; there is no successful skipped mode. CI runs this same command as `Generated full-stack application acceptance`, alongside the existing unit/coverage check. Ordinary unit tests do not download browsers, start these services or publish repositories.

## Scenario and what is generated

Read [project.yaml](project.yaml): a Next.js frontend and one Hono backend with two Clean modules. `customers` owns Customer/CustomerAddress and their relation; `billing` owns Invoice. Billing explicitly imports `getCustomer` from the customers public entry. Customer has public list/filter/pagination, protected mutations and timestamp soft deletion. Invoice exercises decimals, JSON, nullable fields, boolean/default values and application/transport dates. Invoice deletion and all CustomerAddress endpoints are intentionally absent.

Frontend access is mixed: `/` and `/customer` are public; `/invoice` is protected by verified server session. API operations enforce their own resolved policies. Accounts use real Better Auth credential/session behavior. Signup always receives the least-privilege `viewer` default even when a client submits `role: admin`.

| Account | Permissions |
|---|---|
| admin | Customer reads/writes and Invoice reads/writes |
| viewer | Protected Customer reads and Invoice reads |
| accountant | Invoice reads/writes; no protected Customer lookup |
| outsider | No protected operations |

The runner creates these test users through actual signup, then deliberately provisions their roles using SQL in its newly created test database. This is acceptance setup, not a generated role-management endpoint or an auth-account seed feature. Business seeds remain generated source and run before identity provisioning.

## Explicit authored application logic and runtime adapter

The generator produces public contracts, policies, dependency types and composition. It does **not** infer a business workflow from an import. [preview-customer.ts](preview-customer.ts) is explicitly authored acceptance logic copied into `billing/application` after generation. It uses that module's generated `ModuleDependencies` and the real generated producer public wrapper. It checks caller policy, propagates producer denial/validation and returns a supported `not_found` application failure for an absent customer.

[runtime.ts](runtime.ts) is an acceptance-only entry copied beside the generated backend package. Its `/__acceptance/*` routes expose the authored workflow and forged/revoked context probes for verification; they are not generated business endpoints. It imports generated identity, context issuance, composition, persistence and HTTP handlers unchanged. It performs no HTTP loopback for module communication. A deliberate cross-module deep persistence import is temporarily added, rejected by the actual generated boundary command with the expected diagnostics, then removed; clean boundaries and typechecking must pass afterward. The original Worker entry also bundles with `wrangler deploy --dry-run --outdir .acceptance-worker`: this is a local build, with no upload/deployment. The Node adapter uses verification-only dependencies from this checkout; it is not an extra dependency of the generated product scaffold.

The local backend uses Hono's [official Node adapter](https://hono.dev/docs/getting-started/nodejs), passing runtime bindings/execution context to the generated Fetch handler. Next.js runs its production build/server. This test adapter does not change the generated Cloudflare scaffold or introduce a deployment target. The application source and the authored workflow/runtime are typechecked with real dependencies before startup.

## Database isolation and lifecycle

Each run allocates a unique Docker network, a fresh PostgreSQL database named `nordixgen_acceptance_<run-id>`, and a Neon HTTP proxy on a random localhost-only port. Images are pinned in `resources.mjs`. Resource labels include the exact run ID. No external `DATABASE_URL` is consumed and no DROP/reset operation exists. Test migrations/seeds cannot target an existing client database through this command.

The generated local Neon adapter defaults to localhost port 4444. Only the acceptance runtime redirects those Neon HTTP requests to this run's private proxy port, avoiding collisions with existing local services. It verifies the fixed local hostname and permitted ports. This is a real HTTP proxy to PostgreSQL, not an emulated database/driver. Backend/Next bind localhost-only ports selected for this run. No remote GitHub repositories are created or pushed, and nothing is deployed.

Reports, generated apps, logs and screenshots live under the ignored run directory. `state.json` contains disposable runtime credentials and owned process/resource identifiers; never commit or publish it. CI uploads only reports, behavior results, screenshots and sanitized stage logs, excluding runtime state, environment files, cookies and the database. Normal runs/failures clean resources automatically; `--keep` leaves them running for the requested local walkthrough. After an abrupt interruption, use the recorded run ID with `--cleanup`.

## Success evidence and manual walkthrough

Complete success requires every reported stage plus all assertions in [verify.mjs](verify.mjs): real sessions/cookies; public/private page behavior; missing/forged/expired/revoked identity; 401/403/success; trusted-origin checks; declared CRUD/filtering/pagination; omitted routes/actions; actual module calls and callee authorization; defaults and decimal/JSON/date/null transport; browser create/edit/refetch; logout and a new denied account without previous private records; no uncaught browser application errors. Browser network/database/session responses are not mocked. Migrations verify tables from both modules and identity, seeds and a persisted relation.

Read `report.json` for the source revision, stage outcomes, behavior list, result and cleanup/retention status. Read `behaviors.json` for progress on a failed run. Screenshots show the generated workspace and Explorer on desktop and mobile, the invoice page, denied-account state and Explorer permission notice. Browser checks follow the workspace's generated page links, reject horizontal page overflow, inspect readable body constraints/enums/requiredness, recover from malformed JSON and actual backend errors, and persist an authorized Explorer request. The permission check delays the real session response without mocking it: pending/denied requests must show their reason and remain unsent; a permitted public operation must still send successfully. Direct unauthorized API calls remain separately checked for 403. A failed stage remains failed even when earlier stages passed; full acceptance is never inferred from a subset.

After a successful `--keep` run:

1. Open this fixture and compare `backends.modules`, `entities`, `endpoints`, access settings and permissions with the generated source under `project/apps/{api,web}/src`.
2. Open the frontend URL printed in the report. Its workspace links to each generated entity page and the API Explorer. Customer works before login; Invoice takes you to sign-in. In the Explorer, choose an operation to review its field tables and edit the JSON request beside them (below them on mobile).
3. Sign in with **`admin@acceptance.example.test`**, password **`acceptance-local-password-2026`** (local disposable demo only). Copy a Customer ID from `/customer`, then open `/invoice` and use it in the `customerId` field to create/edit a record, filter it and observe refreshed results. The same seed Customer ID is recorded in `project/apps/api/acceptance-persistence.json`. No Invoice delete action exists because it was never declared.
4. Sign out and sign in as **`outsider@acceptance.example.test`** with the same demo password. `/invoice` admits the authenticated page but shows a permission notice, no records and no mutation actions. Direct protected API requests are still denied.
5. Compare customers/billing ownership and public entries in the generated backend. The authored preview is marked explicitly; the table and producer implementation are never imported into billing application code.
6. Stop the retained run with its cleanup command when finished.
