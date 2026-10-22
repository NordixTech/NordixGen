# Roles and permissions

Permissions describe application capabilities. Roles group those permissions in PostgreSQL, so administrators can change access without regenerating or redeploying.

Each account has one server-owned role. The backend loads current grants for protected requests rather than trusting a stale browser role.

## Declare initial roles

Place this fragment on an authentication-enabled backend:

```yaml
authorization:
  roles: [admin, editor, guest]
  adminRole: admin
  defaultRole: guest
  rolePermissions:
    editor: [note:read, note:write]
```

Declare those capabilities on the corresponding business endpoints:

```yaml
permissions: [note:write]
```

Every listed capability is required. Endpoint declarations build the static permission catalog; initial grants must reference known permissions. Custom AI tools also register their declared capabilities. Use exact tokens: partial wildcards such as `note:*` are unsupported.

The administrator receives `*` automatically and must be omitted from `rolePermissions`. If `authorization` is omitted, authenticated backends use `admin` and `user`, with `user` as default.

## Seed behavior

Migrations initialize roles/grants. New ordinary roles receive their declared grants once; later initialization preserves existing metadata and permission edits. Changing YAML does not reconcile existing database roles. Use IAM administration after initialization.

The configured administrator keeps `*` and cannot be deleted. The default role must be different, cannot have IAM management or `*`, and cannot be deleted. Assigned roles cannot be deleted while accounts still reference them. Signup never accepts privileged role selection.

## Provision and administer

Register the operator normally, then run in the backend with `DATABASE_URL` configured:

```bash
pnpm auth:create-admin operator@example.com
```

Open `/admin/roles`. Role management and user-role assignment use separate capabilities:

| Capability | Allows |
| --- | --- |
| `iam:roles:manage` | View/edit roles and grants; inspect audit activity |
| `iam:users:manage-roles` | List accounts and assign existing roles |

User-role assignment can select an administrator role, so treat it as highly privileged. Either capability opens the administration page, but only its corresponding controls/actions are available.

## Platform API

IAM routes are automatically mounted under `/api/auth/iam`:

| Route | Access |
| --- | --- |
| `GET /me` | Verified session; current role and permissions |
| `GET /permissions`, `GET /roles` | Role management |
| `POST /roles`, `PUT /roles/:id`, `DELETE /roles/:id` | Role management |
| `GET /role-options`, `GET /users` | User-role management |
| `POST /users/:id/role` | User-role management; body `{ "role": "editor" }` |
| `GET /audit` | Role management; [audit queries](AUDIT_LOGGING.md) |

Every mutation requires a trusted Origin. Responses are not cached. Invalid identity returns 401; insufficient grants return 403. Frontend visibility is not authorization.

## Administrative safeguards

Role/grant/assignment changes are serialized in database transactions and recheck the actor's current capability. A change removing the last full IAM administrator returns `409` with `code: "last_admin"`; assign another full administrator first.

Changes that remove administrative access from assigned accounts may return `409` with `code: "confirmation_required"` and an impact token. Review the affected accounts/capabilities, then resubmit the same mutation with `confirmation` set to that token. Changed state requires a new review. Confirmation never grants authorization.

Successful IAM changes are [audited](AUDIT_LOGGING.md) after commit. These protections cover IAM routes; direct SQL or custom account-deletion code must preserve equivalent safeguards.

RBAC does not implement tenant ownership, arbitrary ABAC expressions or multiple roles per account. Put record-specific business authorization in application use cases.
