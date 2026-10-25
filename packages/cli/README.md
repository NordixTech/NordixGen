# @nordixgen/cli

Initialize and generate Nordix applications from YAML v2. Requires Node.js 24.22.1+, pnpm 10.5.2, Git author identity and network access for generation.

From a built source checkout:

```bash
node packages/cli/dist/index.js init
node packages/cli/dist/index.js validate -f nordix.config.yaml
node packages/cli/dist/index.js generate -f nordix.config.yaml -o ./my-project
node packages/cli/dist/index.js info
```

An installed package exposes the same commands as `nordixgen`.

`validate` checks configuration and generation support. `generate` requires new/empty output, runs scaffolds/installations, checks application types/boundaries and initializes Git with `main`/`develop`. Optional GitHub publication needs authenticated GitHub CLI and a configured destination. External failures return nonzero status and may leave partial local output.

Generated repositories include Docker workflows and a standalone `pnpm cicd:setup` assistant. Their README and deployment/recovery guides contain project-specific commands. Generation itself makes no cloud changes and does not regenerate edited applications.

Read [Quick start](../../docs/GETTING_STARTED.md), [Local development](../../docs/guides/LOCAL_DEVELOPMENT.md) and [Deployment](../../docs/DEPLOYMENT.md).
