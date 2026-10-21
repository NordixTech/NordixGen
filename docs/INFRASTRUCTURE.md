# Storage

Generate Cloudflare R2 buckets and access them through backend storage ports or the `/r2` document interface. Storage infrastructure is managed with OpenTofu.

## Declare buckets

This project fragment declares two resources and assigns them to a backend:

```yaml
iac:
  repository: app
  cloudflare:
    r2_storage:
      documents: { visibility: private }
      assets: { visibility: public }
```

On the consuming backend:

```yaml
iac:
  r2_storage: [documents, assets]
```

The owner defaults to the first repository. Several backends may share a bucket; this does not allow them to share a database. Omit resources if storage is unnecessary.

Private is the default visibility. Public buckets require a Cloudflare custom domain and zone per environment in the generated `public_domains` variables.

## Set up cloud storage

After publishing the generated repository, run `pnpm cicd:setup` and enable R2 in the Cloudflare account. Add Workers R2 Storage Edit and the appropriate user/account API-token read/edit permissions to the deployment token. Custom domains also need zone access.

The assistant configures infrastructure build secrets and scoped backend transfer-signing credentials. Credentials stay in backend/build secrets, never frontend bundles or tracked profiles. Native binding operations do not require S3 signing keys.

Commit generated provider lockfiles, not state, plans or secrets. See [Deployment](DEPLOYMENT.md) for the branch/build workflow.

## Use storage in code

`StoragePort` supports upload, streaming download, paginated listing, existence checks, deletion, public URL resolution and signed GET URLs. The backend composition creates adapters from bindings and supplies them to modules.

Implement business ownership and tenant checks in your use case. A storage port does not automatically associate files with a business record or authorize the current user.

## Document management

The frontend `/r2` interface lists buckets attached to connected backends and supports uploads, listing, previews and downloads. Management routes require a verified session plus `storage:<key>:read` or `storage:<key>:write`; public bucket visibility does not grant management access. Backends without authentication keep management routes closed.

Direct uploads use `POST /api/storage/:storage/upload-url` to authorize bounded metadata, then send the file straight to R2:

- Maximum size: 100 MiB.
- Signed PUT validity: five minutes.
- The URL binds the key, exact length/type and no-overwrite condition.
- Reusing a URL or racing an existing key cannot overwrite the object.
- An unused authorization creates no object.

Use exact frontend origins in generated `storage_upload_origins`. Setup derives these and passes `R2_UPLOAD_ORIGINS` to builds; update it when domains change. Wildcard upload origins are not appropriate. Signing credentials require bucket-scoped S3 object read/write access. The byte-upload management endpoint returns 410; use the direct-upload flow.

The manager lists 50 objects per page and previews supported raster images, sandboxed PDF and escaped text. It does not embed active HTML/SVG as application content. No business-file registry or automatic orphan cleanup is created.

## Downloads

| Path | Behavior |
| --- | --- |
| Authenticated streaming | Same-origin frontend Worker to private backend; verifies current session/grants on each request |
| Signed GET URL | Optional reusable bearer link, default five minutes, maximum seven days |
| Public URL | Requires configured public bucket domain |

Private streaming preserves response length and attachment/no-store headers without buffering through the Next.js response bridge. It supports single byte ranges, suffixes and If-Range; invalid ranges return 416, multiple ranges fall back to a full response. Conditional reads prevent mixing file versions during transfer.

Do not log signed links. JavaScript cross-origin downloads need bucket CORS; normal download navigation does not. A missing signing setup returns an unavailable response.

## Change infrastructure

Edit generated `infra/terraform/*.tf` and environment `.tfvars` directly. Keep stable resource addresses and one state owner. The `storage` output maps backend → resource key → `{ binding, bucket, public_url }`; deployment uses it for bindings and signing permissions.

Native builds apply staging from `develop` and production from `main`. For split repositories, deploy the infrastructure owner before consumers when resources change. State is separated by project/environment, with state and apply locks. Back up state independently and inspect interrupted applies before retrying or clearing a stale lock.

PR plans show actions and a bounded bucket-content check. Merging applies deletions/replacements automatically and may empty deleted application buckets permanently. Renaming does not migrate files; back up or migrate data before merging a destructive plan. The state bucket is excluded from application-bucket emptying.

## Local behavior

Docker supplies Miniflare R2. Backend-native uploads work locally; cloud-style direct signing needs a compatible S3 setup and is not automatically available through local Miniflare. R2 operations/storage and Worker execution can incur charges; account limits still apply.
