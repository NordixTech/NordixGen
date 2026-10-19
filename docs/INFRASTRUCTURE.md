# Cloudflare R2 infrastructure

NordixGen generates optional OpenTofu infrastructure alongside the existing Workers deployment. Hosting stays on Workers: Next.js uses OpenNext and backends use Hono. No hosting selector or GitHub Actions workflow is introduced.

Declare resources once in `iac.cloudflare.r2_storage` and references in each backend's `iac.r2_storage`. Multiple backends may share a resource. `iac.repository` optionally selects the owning repository; the first repository is the default. Without resources, no state bucket or infrastructure setup is required. The generation YAML lifecycle is unchanged.

## Initial setup

Run the generated `pnpm cicd:setup` after repository publication. When R2 is declared, enable R2 Object Storage in the Cloudflare dashboard and add these permissions to the deployment token:

- Account: Workers R2 Storage Edit.
- User: API Tokens Read/Edit, or Account: Account API Tokens Read/Edit when creating account-owned download credentials.
- Existing deployment permissions remain required. Public bucket domains also require access to the relevant zone.

The assistant reuses the setup token for CI infrastructure changes and PR plans. It does not create separate administrative or review API tokens. It creates only scoped backend download-signing credentials, reused across deployments and adjusted when bucket associations change. Native binding uploads and streaming do not need S3 keys.

Secrets are masked in prompts, kept out of manifests/profiles/Git, and stored in Cloudflare's build secret configuration or backend Worker secrets. Signing secrets never enter frontend Workers or browser bundles. An authorized operator performs setup; this is secret hiding, not a restriction against an administrator deploying arbitrary production code.

The assistant creates/reuses a private state bucket outside the managed application resources. State is separated by project and staging/production within the account. OpenTofu uses its S3 backend with state locking; a second apply lock coordinates application builds and credential/binding synchronization. Commit markers avoid duplicate applies for the same revision, and branch-tip checks reject superseded builds. Back up state independently. An interrupted apply may leave partial changes; inspect failures before retrying or removing a stale lock.

## Editing an independent generated project

Edit `infra/terraform/*.tf` and the environment `.tfvars` directly. No original YAML or generator is needed. Add resources and associate them with consumers in the `storage` output. Its contract is backend name → storage key → `{ binding, bucket, public_url }`. Those outputs drive Wrangler bindings, runtime adapter metadata and signing permissions. Keep stable resource addresses to avoid accidental replacement. Keep one state owner per resource.

`develop` builds apply staging infrastructure before deployment; `main` builds apply production. Split repositories read the owner's shared output marker, so deploy the owner before consumers when adding resources. Workers Builds runs OpenTofu in its build container, not inside an application Worker. The pinned OpenTofu archive is downloaded from its official release and checksum-verified; an installed supported binary can be selected with `TOFU_BIN`. Commit the generated provider lockfile, never state or plan files.

PR branches run a plan and update a GitHub comment with the target environment, revision, resource actions and a timestamped empty/contains-files/unverified bucket check. The check lists at most one object and does not read its contents or publish object names. A signed GitHub PR webhook triggers the native review build when a PR opens or changes. Setup needs GitHub repository contents read, PR comments write and webhook administration access. Fork PRs do not receive this mechanism's secrets or run plans.

The comment is informational. Merging automatically applies deletions and replacements without an approval command or file. The runner empties only application buckets explicitly deleted by the saved plan, then applies that plan. It refuses to empty the state bucket. This permanently deletes stored files; renaming does not migrate them. Back up or migrate data before merging when needed. New writes can arrive after the PR check. Genuine provider or deployment errors still fail the build.

## Application access

Application code uses `StoragePort` for upload, streaming download, existence checks, deletion, public URL resolution and signed GET URLs. The platform factory creates adapters from bindings and supplies them to module composition. Authored controllers/use cases must perform session, permission and object-ownership checks before invoking the port; infrastructure declaration does not create an unrestricted file endpoint.

Authenticated streaming goes through the same-origin frontend proxy and private backend binding. Signed URLs are reusable bearer links until expiry (default five minutes; maximum seven days) and use R2's S3 domain. Browser direct downloads are an accepted public-network exception; backend application URLs stay private. Do not log signed links. JavaScript cross-origin fetch requires explicit bucket CORS; download navigation does not.

Private buckets are the default. Public buckets require a Cloudflare custom domain and zone in each environment's `public_domains` variable. R2 storage, operations and Workers execution can incur charges even though transfer has no egress fee. Docker uses Miniflare for local R2 and private bridge transport; no cloud signing credentials are copied into local containers.
