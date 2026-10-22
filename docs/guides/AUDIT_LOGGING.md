# Audit logging

Audit logging records who acted, what changed and when. Authentication and IAM events are captured automatically on authenticated backends. Business endpoints opt in individually.

## Enable business capture

Add this field to an endpoint:

```yaml
audit: true
```

Capture requires backend persistence and does not alter its access policy. A public operation remains public and records an anonymous actor when no verified account exists.

The backend owns an `audit_logs` table with actor, action, resource, before/after snapshots, request metadata and creation time. Actor identifiers have no foreign key, preserving history when an account is deleted.

## What is captured?

| Event | Recorded data |
| --- | --- |
| Authentication | Signup, completed login/logout, recovery and two-factor events; failed sign-ins are distinct |
| IAM mutation | Committed role/grant/assignment changes |
| Create | Returned records as after-data |
| Update | Before-image and resulting after-image |
| Hard delete | Before-image and null after-image |
| Soft delete | Before-image and changed deletion marker |
| Read/custom operation | Returned output as after-data |

Business metadata includes operation ID, declared method/path, status, elapsed time, parameters and affected IDs. Rejected requests retain their status without inventing a successful change. Internal module calls are not duplicated as HTTP audit entries. Side effects in custom code are not inferred automatically.

Credential-like keys are redacted recursively; nesting, collection sizes and strings are bounded. Raw authentication inputs, tokens and cookies are not stored. Other business data may remain visible in snapshots, so set appropriate retention/access policies in your application.

## Inspect activity

The `/audit` Activity page requires `iam:roles:manage` or administrator access. It provides actor/action/date filters, pagination and before/after inspection.

For API access, use `GET /api/auth/iam/audit`:

| Query | Behavior |
| --- | --- |
| `actor`, `action` | Filter by actor/action |
| `from`, `to` | ISO timestamps with timezone |
| `page` | Starts at 1 |
| `pageSize` | Default 25, maximum 100 |

Responses are `{ items, total, page, pageSize }`, ordered by creation time and UUID descending. Backends without identity can capture business events but do not expose an unauthenticated audit reader.

## Delivery guarantees

Audit writes run asynchronously outside the business transaction. Cloudflare uses `waitUntil`; the local runtime dispatches an error-isolated promise. Audit failure does not fail or roll back the primary operation.

There is no durable queue, retry or delivery guarantee. Do not use this stream as proof of guaranteed financial/compliance event delivery without adding the required application infrastructure.
