# Publishing NordixGen

NordixGen is distributed through the public npm registry as `@nordix-tech/nordixgen` (the `nordixgen` command) and `@nordix-tech/nordixgen-core` (the engine). Users need Node.js 24.22.1+, pnpm 10.5.2, Git with an author identity, and network access for generation. They do not need an npm account or a checkout of this repository.

```sh
npx @nordix-tech/nordixgen@latest init
# Or install once:
npm install -g @nordix-tech/nordixgen
nordixgen init
```

Use `@0.1.0` or another published version instead of `@latest` to select a fixed generator release. Noninteractive setup is available with `nordixgen init --name my-project --frontend yes --file nordix.config.yaml`.

## One-time maintainer setup

Create a personal account at [npm signup](https://www.npmjs.com/signup), verify its email and enable 2FA. Create the `nordix-tech` organization from the profile menu using the free public-package plan. The npm organization is separate from the GitHub organization; a company website is not required.

The packages must exist before configuring their trusted publishers. For their initial publication, an authorized maintainer signs in with `npm login`, builds and tests the source, runs `pnpm release:pack` and `pnpm test:package`, then publishes the core tarball followed by the CLI tarball with `npm publish <tarball> --access public`. Complete npm's interactive 2FA verification when requested. Inspect tarball contents before publishing; npm versions cannot be overwritten.

Configure a trusted publisher separately for each package with these exact values:

| Setting | Value |
| --- | --- |
| Provider | GitHub Actions |
| Organization | `NordixTech` |
| Repository | `NordixGen` |
| Workflow filename | `release.yml` |
| Environment | Leave empty |
| Allowed operations | Direct publication and dist-tag management |

Use the package's npm settings or `npm trust` with the options supported by the installed npm version. Direct publish and dist-tag management are both needed: publication first uses `candidate`, then updates `latest` after both packages are available. Do not configure only staged publishing, which would require manual approval on each release. No npm publishing token is stored in GitHub. The workflow uses a short-lived OIDC identity; `id-token: write` is required. Complete the first trusted publication within npm's configuration validation window.

See [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/) and [npm organization setup](https://docs.npmjs.com/creating-an-organization/).

## Every push to main

1. The release workflow queues the push without canceling earlier pending releases (GitHub supports up to 100 queued runs per group).
2. It runs the complete reusable CI workflow, including database, Docker and generated application checks. A failed check blocks publication.
3. It allocates a deterministic version: the checked-in major/minor and base patch, plus the release workflow run number as the patch offset. For example, base `0.1.0` and run 15 produce `0.1.15`. Numbers may have gaps when a run fails; rerunning that same run reuses its version. Change the major/minor base in both package manifests deliberately for larger releases; do not automatically commit version changes to main.
4. It builds with the allocated version, packs both packages, and installs the tarballs outside the checkout. The package test exercises both engine module formats, CLI help/version/info, noninteractive init, validation and real backend project generation. It saves the tarballs and release plan as a GitHub Actions artifact.
5. It publishes core before CLI, verifies each registry tarball's integrity and source identity, and promotes `latest` only after both exist. An older rerun cannot move `latest` behind a newer version.
6. It creates a `v<version>` tag at the source commit and a GitHub Release, then verifies installation from the public registry. GitHub Packages is not required. npx executes the same npm packages; it has no separate registry.

The workspace dependency remains `workspace:*` in source; pnpm converts it into the matching fixed core version in the packed CLI. Release versions and source commit/run identity are embedded in package metadata. The repository root remains private intentionally.

## Verification and recovery

```sh
pnpm lint
pnpm typecheck
pnpm test:release
pnpm build
pnpm test
pnpm release:pack
pnpm test:package
# After publication, verify one fixed version from npm:
pnpm test:package 0.1.0
```

Rerun the failed workflow run to recover a partial publication. It verifies and skips already published matching tarballs, finishes the missing package, and repairs channel/release steps. An integrity or identity mismatch stops the run rather than silently accepting a version from another source. If a tarball changes because the toolchain or dependency contents changed, investigate and use a new workflow run/version; do not overwrite npm history. An explicitly dispatched workflow is allowed only from `main` and allocates its own version.

If npm returns E404 during publishing, verify the npm scope, package ownership, exact GitHub repository/workflow settings and trusted-publisher expiry. An E404 alone does not prove the package is absent. If publishing succeeds but promotion fails, check dist-tag authorization. If tests or packing fail, no npm publication step runs.

The two npm packages cannot be published in a single atomic registry transaction. During recovery, the candidate channel can contain an incomplete release; consumers should use `latest` or an explicit verified version.
