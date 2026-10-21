# Continue development after generation

NordixGen is an initializer, not a runtime dependency or an in-place regeneration engine. Once generated, the application repository is the maintained product. Keep its lockfile, migrations, infrastructure files and operational docs in Git. Editing the original YAML does not reconcile an existing application's source, IAM records or deployed infrastructure.

## Add or change a business operation

Before first generation, declare the operation in YAML so its backend use case, persistence mapping, HTTP contract, browser client and supported screen actions agree. Validate before generating. Module imports only wire available dependencies; they do not implement business decisions.

After generation, implement the change in the owning module. Update its application input/output and use case, outbound port and persistence adapter where needed, then the HTTP controller and frontend client/form/query together. Keep transport DTOs separate from domain/application values: dates are application `Date` values but ISO strings over HTTP. Add tests around the business rule and its failure cases rather than relying on compilation alone.

Keep domain and application code independent of Hono/Drizzle. Use the selected [architecture layout](generation/DIRECT_BACKEND.md#architecture-contracts). Export only intentional public application contracts through the module entry and declare consuming dependencies. Never import another module's private tables/repositories or the platform all-table schema into a business module. Run the generated backend's `pnpm check:boundaries` after changes.

For cross-module workflows, invoke the owner's typed public operation with an issued trusted context and handle its `ApplicationResult`. Do not construct identity claims from request JSON. Caller and callee policies both apply. Earlier writes are not rolled back when a later module call fails; design transactional consistency explicitly when the use case needs it. See [public module communication](generation/PUBLIC_MODULES.md).

## Change persistence safely

Edit the owning module's schema and any affected contracts/adapters, then run in the backend:

```bash
pnpm db:generate
# Review the generated SQL and migration journal before applying.
pnpm db:migrate
pnpm typecheck
pnpm check:boundaries
```

Database commands need `DATABASE_URL` in the Node shell, independently of `.dev.vars`. Commit SQL and its journal; deployment and Docker startup apply that history. Do not recreate an initial migration to hide an already-deployed schema change. Review destructive statements and preserve recovery options before applying them to staging/production.

Synthetic seeds are test/demo business data, not login provisioning. Docker tracks their first completion; a failed seed blocks automatic retry to avoid duplicate data. Inspect the database before recovering. IAM initialization is separately idempotent and preserves administrator changes to existing ordinary roles/grants.

## Add protected pages or permissions

Guard every authored private server entry before returning content. The initial YAML page inventory does not automatically cover newly authored pages. Keep one frontend identity authority and use the generated session/IAM helpers; do not trust cookies, UI visibility or cached role labels as authorization.

Enforce new permissions in the backend/application boundary and register them in the application's static capability catalog. Assign grants through IAM. Adding a YAML seed grant does not update an existing database role. Keep the default role unprivileged and preserve system/last-administrator protections. Test anonymous, allowed and denied requests, trusted-origin mutations and sign-out/cache transitions.

Query keys and invalidation must preserve backend/module/operation and private identity scope. Use TanStack Query for remote data and Zustand for UI state. Update clients, queries and forms when an operation's contract changes; do not add a visible button that assumes an undeclared or absent route.

## Extend platform integrations

| Need | Continue here |
| --- | --- |
| New AI tools | Add exported `*.tool.ts` definitions and restart discovery; use trusted `ctx.invoke` for existing operations. See [AI/MCP](generation/AI_MCP.md). |
| New storage resources or domains | Edit generated OpenTofu and storage output associations; update exact upload origins and review the PR plan. See [infrastructure](INFRASTRUCTURE.md). |
| Business file associations | Author persistence and object-ownership checks; the storage manager supplies no file registry or orphan cleanup. |
| Audit new business behavior | Preserve opt-in capture or author appropriate audit events. Do not assume background audit is durable or part of the business transaction. See [audit](generation/AUDIT_LOGGING.md). |
| New frontend styling | Edit semantic tokens/components; check both modes and contrast. Persisted mode selection is independent of identity. |

## Release and maintain

Run the generated project's type, boundary, business and build checks before merging. Push `develop` for staging and verify the actual user journeys, database, private bindings, delivery and storage there. Push/merge `main` for production according to the project's release process. The native build applies committed migrations and, when configured, infrastructure changes; inspect destructive changes before merging.

Maintain generated README/deployment/recovery instructions whenever commands, domains, permissions or topology change. Keep staging and production secrets separate. Rehearse the generated recovery procedure and back up infrastructure state independently. To compare a newer NordixGen version, generate a separate disposable project and review differences manually; it is not an upgrade command for an edited repository.
