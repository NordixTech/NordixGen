# Unified asynchronous audit logging

Every generated backend with persistence owns one `audit_logs` table in its own database. It contains a UUID, actor ID, action, resource type/ID, JSONB before/after snapshots, IP address, User-Agent, metadata and creation time. Actor/time, resource/ID and action/time indexes support administration queries. Actor identifiers have no foreign key: deleting a user does not delete their history.

## Events

Authentication and IAM events are enabled with backend authentication. The native Better Auth audit plugin runs after the other plugins. It records signup, completed email/username/social sign-in, signout, password recovery and two-factor operations. OAuth initiation and a pending two-factor challenge are not successful sign-ins; a successful verification records both the two-factor event and sign-in. Failed sign-ins are distinct events. Unauthenticated recovery requests use `anonymous`; no password, verification token, callback URL, cookie or authentication response is copied into the event.

IAM writes publish `iam.role.created`, `iam.role.updated`, `iam.role.deleted` and `iam.user.role_assigned` only after their transaction commits. Confirmation previews, last-admin/protected-role rejections and rolled-back writes do not publish successful-change events. The state is captured while the IAM lock is held, before its connection closes.

Business endpoints opt in independently:

```yaml
endpoints:
  - backend: api
    method: PATCH
    path: /api/orders/{orderId}
    operationId: updateOrder
    entity: Order
    audit: true
    pathParams:
      - name: orderId
        field: { entity: Order, field: id }
    requestBody:
      useCase: { entity: Order, operation: update }
```

`audit` is an optional boolean, disabled when omitted. It requires backend persistence and does not change authorization. Public endpoints remain public and record `anonymous` when there is no verified account. Actions use the lower-case entity name with `created`, `updated`, `deleted`, `read` or `executed`; metadata includes `operationId`, declared method/path, path/query parameters, status, elapsed time and affected IDs. The backend's existing authoritative identity read supplies the actor.

Generated creates capture returned records. Updates/deletes capture the before-image using a row-locking select in the same atomic Neon HTTP batch as the write; the returned write supplies the after-image. Hard deletion has a null after-image; soft deletion shows its changed marker. Bulk changes use arrays and affected IDs. Reads/custom operation output is captured as after-data. Authored side effects behind custom operations are not inferred. Rejected/failed HTTP attempts include their response status without inventing successful data changes. Internal application calls are not separately duplicated as HTTP audit entries.

## Dispatch and failure behavior

Audit persistence is outside the business transaction. The response never awaits the audit insert. Cloudflare uses `executionContext.waitUntil`; local Node dispatches the same error-isolated promise without waiting. Writes use independent Neon HTTP requests, so closing an IAM WebSocket connection does not cancel its audit write. An unavailable audit table or database write failure logs a generic internal error and does not fail or roll back the user's operation. Capture preparation has a small synchronous cost; no durable queue, retries or delivery guarantee is introduced.

Snapshots are copied before background work starts. Credential-like keys (passwords, secrets, tokens, cookies, authorization, OTP/backup/recovery/verification codes) are redacted recursively. Strings, collection sizes and nesting depth are bounded. Raw authentication inputs and headers are not stored. IP uses the platform `CF-Connecting-IP` header; it remains null when the runtime provides none. A deployment forwarding this header must preserve its trusted ingress origin. User-Agent is bounded. Business data in permitted fields remains visible to authorized audit readers.

## Query and inspect

`GET /api/auth/iam/audit` requires a verified session and current `iam:roles:manage` permission. Optional filters are `actor`, `action`, `from` and `to`; dates are ISO timestamps including timezone. `page` starts at 1 and `pageSize` defaults to 25, with a maximum of 100. Results are `{ items, total, page, pageSize }`, ordered by creation time and UUID descending. Business-only backends without authentication record events but do not expose an unauthenticated audit reader.

The **Auditoría** sidebar destination at `/audit` exposes filters by actor ID, action and date range, pagination and refresh, with before/after JSON differences and request details. The same viewer remains available in the **Activity** tab on `/admin/roles`. Both require `iam:roles:manage` (or `*`); user-role-only operators cannot access them. The standalone page rechecks grants on the server, and its client stops rendering the viewer when access is lost. The legacy `auth_iam_audit` table is not regenerated or imported.

## Verification

The audit suite holds writes unresolved while application responses complete, checks Worker/Node failure isolation, redaction, auth hooks and generated-code compilation. PostgreSQL integration checks exact snapshots, filtering and pagination, and temporarily removes the audit table while asserting that IAM/business writes still succeed. The commerce acceptance check exercises protected audit queries and the desktop/mobile Activity tab and captures screenshots. These checks supplement the existing IAM concurrency and transactional rollback checks.
