# Continue development

After generation, the application repository is your source of truth. Edit its source, migrations and infrastructure directly. Changing the original YAML does not synchronize an existing application.

## Add business behavior

Before generation, declare entities and endpoints so backend operations, clients and screens agree. After generation, update the owning module's use case, input/output contract, port/adapter and controller as needed. Update affected frontend clients/forms/queries together.

Keep domain/application code independent of Hono and Drizzle. Share business behavior through [public module contracts](guides/MODULE_COMMUNICATION.md), not private tables or repositories. Direct calls carry trusted context and do not create an automatic shared transaction.

Run the generated backend's `pnpm check:boundaries` and tests for the business rule and failure cases.

## Evolve the database

In the generated backend, with `DATABASE_URL` set in the Node shell:

```bash
pnpm db:generate
# Review SQL and the migration journal.
pnpm db:migrate
pnpm typecheck
pnpm check:boundaries
```

Commit the migration history. Do not replace an initial migration already applied to an environment. Plan recovery before destructive changes.

Synthetic seeds are optional business fixtures. IAM initialization is separate and preserves ordinary existing role/grant edits. Use IAM administration to change live access.

## Add pages and permissions

New private server pages need explicit guards before returning content. Use the generated identity authority/helpers and enforce capabilities in backend application code. UI visibility and cached role labels are not authorization.

Register new capabilities in the application catalog and assign their grants through IAM. Keep query keys/invalidation scoped to backend, operation and identity. Test anonymous, allowed and denied requests plus logout/cache transitions.

## Extend integrations

| Need | What to edit |
| --- | --- |
| Custom AI behavior | Export a `*.tool.ts` definition, restart discovery and assign its capability; [AI guide](guides/AI.md) |
| Storage resources/domains | Generated OpenTofu, storage outputs and exact upload origins; [storage guide](INFRASTRUCTURE.md) |
| File-to-record ownership | Author a data model and ownership checks; storage provides no automatic business registry |
| Additional audit capture | Preserve endpoint capture or author events for custom side effects; [audit guide](guides/AUDIT_LOGGING.md) |
| Styling | Semantic tokens and components; [themes](configuration/THEMES.md) |

## Release changes

Run types, boundaries, business tests and builds. Deploy `develop` to staging and verify the real workflows before production through `main`. Review migration and infrastructure deletion/replacement before merging.

Keep the application's README, deployment and recovery instructions current. To compare a newer generator version, generate into a separate disposable directory and review differences manually. There is no in-place regeneration or automatic upgrade over edited code.
