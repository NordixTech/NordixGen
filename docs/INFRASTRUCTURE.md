# Cloudflare R2 infrastructure

NordixGen generates optional OpenTofu infrastructure alongside the existing Workers deployment. Hosting stays on Workers: Next.js uses OpenNext and backends use Hono. No hosting selector or GitHub Actions workflow is introduced.

Declare resources once in `iac.cloudflare.r2_storage` and references in each backend's `iac.r2_storage`. Multiple backends may share a resource. `iac.repository` optionally selects the owning repository; the first repository is the default. Without resources, no state bucket or infrastructure setup is required. The generation YAML lifecycle is unchanged.

## Initial setup

Run the generated `pnpm cicd:setup` after repository publication. When R2 is declared, enable R2 Object Storage in the Cloudflare dashboard and add these permissions to the deployment token:

- Account: Workers R2 Storage Edit.
- User: API Tokens Read/Edit, or Account: Account API Tokens Read/Edit when creating account-owned download credentials.
- Existing deployment permissions remain required. Public bucket domains also require access to the relevant zone.

The assistant reuses the setup token for CI infrastructure changes and PR plans. It does not create separate administrative or review API tokens. It creates only scoped backend transfer-signing credentials, reused across deployments and adjusted when bucket associations change. Native binding uploads and streaming do not need S3 keys.

Secrets are masked in prompts, kept out of manifests/profiles/Git, and stored in Cloudflare's build secret configuration or backend Worker secrets. Signing secrets never enter frontend Workers or browser bundles. An authorized operator performs setup; this is secret hiding, not a restriction against an administrator deploying arbitrary production code.

The assistant creates/reuses a private state bucket outside the managed application resources. State is separated by project and staging/production within the account. OpenTofu uses its S3 backend with state locking; a second apply lock coordinates application builds and credential/binding synchronization. Commit markers avoid duplicate applies for the same revision, and branch-tip checks reject superseded builds. Back up state independently. An interrupted apply may leave partial changes; inspect failures before retrying or removing a stale lock.

## Editing an independent generated project

Edit `infra/terraform/*.tf` and the environment `.tfvars` directly. No original YAML or generator is needed. Add resources and associate them with consumers in the `storage` output. Its contract is backend name → storage key → `{ binding, bucket, public_url }`. Those outputs drive Wrangler bindings, runtime adapter metadata and signing permissions. Keep stable resource addresses to avoid accidental replacement. Keep one state owner per resource.

`develop` builds apply staging infrastructure before deployment; `main` builds apply production. Split repositories read the owner's shared output marker, so deploy the owner before consumers when adding resources. Workers Builds runs OpenTofu in its build container, not inside an application Worker. The pinned OpenTofu archive is downloaded from its official release and checksum-verified; an installed supported binary can be selected with `TOFU_BIN`. Commit the generated provider lockfile, never state or plan files.

PR branches run a plan and update a GitHub comment with the target environment, revision, resource actions and a timestamped empty/contains-files/unverified bucket check. The check lists at most one object and does not read its contents or publish object names. A signed GitHub PR webhook triggers the native review build when a PR opens or changes. Setup needs GitHub repository contents read, PR comments write and webhook administration access. Fork PRs do not receive this mechanism's secrets or run plans.

The comment is informational. Merging automatically applies deletions and replacements without an approval command or file. The runner empties only application buckets explicitly deleted by the saved plan, then applies that plan. It refuses to empty the state bucket. This permanently deletes stored files; renaming does not migrate them. Back up or migrate data before merging when needed. New writes can arrive after the PR check. Genuine provider or deployment errors still fail the build.

## Application access

Application code uses `StoragePort` for upload, streaming download, paginated object listing, existence checks, deletion, public URL resolution and signed GET URLs. The platform factory creates adapters from bindings and supplies them to module composition. The generated `/r2` dashboard lists instances attached to connected backends, marks their configured public/private visibility, uploads documents and provides safe previews and two download paths. Platform `/api/storage/*` handlers require a verified session and current `storage:<key>:read` or `storage:<key>:write` grants; the configured administrator has full access. Public bucket visibility does not grant dashboard access. Backends without authentication keep these management routes closed. Authored controllers/use cases must still enforce their own access and object-ownership checks when using the port.

## Private streaming downloads

Authenticated streaming goes through the same-origin frontend Worker and private backend binding. For connected storage download routes, the generated custom Worker forwards the native response body before the Next.js/OpenNext Node response bridge. It does not buffer or iterate over file chunks and preserves the backend's Content-Length, attachment and no-store headers. The private backend still verifies the session and current storage grants for every download; this path never redirects to a public R2 link. Other application routes retain the normal Next.js handler.

Private downloads support single HTTP byte ranges, suffixes and If-Range validators. A valid fragment returns 206 with its exact Content-Range and Content-Length; an unsatisfiable range returns 416. Multi-range requests fall back to a full response. A conditional R2 read prevents combining different file versions when an object changes during a transfer. Permission checks run before any object metadata or bytes are read.

## Backend placement

Generated backend Workers initially enable Smart Placement in each environment; frontend Workers retain edge placement. The generated cicd:setup assistant shows the Neon region and lets the user choose an independent Cloudflare backend region reference, marking the matching region. It applies the choice to staging and production and preserves it in Workers Builds through NORDIX_WORKER_PLACEMENT. Setup and subsequent build/deploy stages update only the selected environment placement in wrangler.jsonc. Existing Neon projects are never moved by this choice. For manual configuration, set placement.region, for example aws:us-east-1, or keep Smart Placement. Measure the result for the actual database and callers; placement does not add CPU or memory and is not a guarantee of lower latency.

## Signed downloads and bucket visibility

Signed URLs are a separate, optional download path: reusable bearer links until expiry (default five minutes; maximum seven days), using R2's S3 domain. Browser direct downloads are an accepted public-network exception; backend application URLs stay private. Do not log signed links. JavaScript cross-origin fetch requires explicit bucket CORS; download navigation does not.

Private buckets are the default. Public buckets require a Cloudflare custom domain and zone in each environment's `public_domains` variable. R2 storage, operations and Workers execution can incur charges even though transfer has no egress fee. Docker uses Miniflare for local R2 and private bridge transport; no cloud signing credentials are copied into local containers.

## Direct uploads and document management

Document management authorizes direct browser-to-R2 uploads up to 100 MiB via POST /api/storage/:storage/upload-url. The backend accepts bounded JSON metadata only; the legacy byte-upload endpoint returns 410. Signed PUT links expire in five minutes and bind the key, exact Content-Length, Content-Type and If-None-Match: *. The browser supplies a File body (the browser sets Content-Length), omits application cookies on R2 requests and treats a successful R2 response as upload completion. Existing objects cannot be overwritten, including racing requests or URL reuse. Issuing an unused URL creates no object. No file registry, business association or automatic orphan deletion is introduced. The manager paginates listings at 50 objects. Backend downloads stream with attachment and sandbox headers. Signed downloads use five-minute links and return a clear unavailable response when signing credentials are missing. The browser previews supported raster images, PDF in a sandboxed frame, and escaped text; active HTML/SVG is never embedded as application content. The `examples/performance/project.yaml` fixture includes administrator, manager, operator and default guest roles with explicit storage grants.

Direct uploads require bucket-scoped S3 object read/write permissions on backend signing credentials. Existing credentials are upgraded on the next infrastructure apply. Generated OpenTofu manages PUT-only bucket CORS through storage_upload_origins; cicd:setup derives exact connected frontend origins per environment and supplies R2_UPLOAD_ORIGINS to infrastructure builds. For manual setup, set storage_upload_origins in environment tfvars; when using setup-managed origins, update R2_UPLOAD_ORIGINS after domain changes. Do not use wildcard origins. Direct cloud upload signing is unavailable in local Miniflare unless a compatible S3 signing setup is supplied. Backend-native StoragePort.upload remains available for authored server use cases.
