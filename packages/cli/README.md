# @nordix-tech/nordixgen

Initialize and generate Nordix applications from YAML v2. Requires Node.js 24.22.1+, pnpm 10.5.2, Git author identity and network access for generation.

Install from npm with `npm install -g @nordix-tech/nordixgen`, or run `npx @nordix-tech/nordixgen@latest init` without a global install.

After installing:

```bash
nordixgen init
nordixgen validate -f nordix.config.yaml
nordixgen generate -f nordix.config.yaml -o ./my-project
nordixgen info
```

For noninteractive setup, use `nordixgen init --name my-project --frontend yes --file nordix.config.yaml`. Pin a published generator version with `npx @nordix-tech/nordixgen@0.1.0 init`.

`validate` checks configuration and generation support. `generate` requires new/empty output, runs scaffolds/installations, checks application types/boundaries and initializes Git with `main`/`develop`. Optional GitHub publication needs authenticated GitHub CLI and a configured destination. External failures return nonzero status and may leave partial local output.

Generated repositories include Docker workflows and a standalone `pnpm cicd:setup` assistant. Their README and deployment/recovery guides contain project-specific commands. Generation itself makes no cloud changes and does not regenerate edited applications.

Read [Quick start](https://github.com/NordixTech/NordixGen/blob/main/docs/GETTING_STARTED.md), [Local development](https://github.com/NordixTech/NordixGen/blob/main/docs/guides/LOCAL_DEVELOPMENT.md) and [Deployment](https://github.com/NordixTech/NordixGen/blob/main/docs/DEPLOYMENT.md).
