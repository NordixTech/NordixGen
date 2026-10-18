# @nordixgen/cli

Initialize new Nordix projects from strict YAML v2 using the fixed TypeScript/Hono/Next.js/Drizzle/Neon/Better Auth stack. Node.js 24+ and pnpm 10.5.2 are required. Install Git and authenticate GitHub CLI only when the configuration opts into repository publication.

From a source checkout, install with `pnpm install --frozen-lockfile`, then `pnpm build`:

```bash
node packages/cli/dist/index.js --help
node packages/cli/dist/index.js init
node packages/cli/dist/index.js validate -f nordix.config.yaml
node packages/cli/dist/index.js generate -f nordix.config.yaml -o ./new-project
```

An installed package exposes the same commands as `nordixgen`. `validate` checks configuration, resolution and generation readiness. `generate` requires a new/empty directory, prepares files, runs pinned official scaffolds, installs dependencies and checks application types and module boundaries before optional Git/GitHub publication. Failures return a nonzero exit status and may leave output for inspection; the CLI does not overwrite or regenerate edited applications.

One or multiple Clean modules are supported. Hexagonal/Onion and many-to-many generation fail before effects. Endpoints explicitly declare business operations; entity declarations do not create implicit CRUD. Generated environment examples and README files explain runtime origins, database migrations and startup. Configure secrets outside YAML.

See the [commerce example](../../examples/full-stack-commerce/README.md) for a complete YAML, direct generation commands and optional fresh PostgreSQL/HTTP/browser verification. Its local Node adapter and Docker services are verification helpers; generated backend production output targets Cloudflare Workers. See [CLI workflow](../../docs/generation/CLI_WORKFLOW.md) for details and limits.
