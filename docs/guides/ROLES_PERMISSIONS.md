# Roles and permissions

Permissions describe application capabilities. Roles group those permissions in PostgreSQL, so administrators can change access without regenerating or redeploying.

Global roles govern the platform; organization roles govern one active company. Both domains are opt-in. Each enabled domain defaults to `mode: single`; use `multiple` only when accounts need the union of several roles. The backend resolves current grants in one query rather than trusting browser role labels.

## Declare initial roles

Place this fragment on an authentication-enabled backend:

```yaml
authorization:
  global:
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

The administrator receives `*` automatically and must be omitted from `rolePermissions`. An omitted `global` or `organizations` block is disabled. Authentication alone creates no role catalog, administrator bootstrap or administration pages. An explicit authorization object must enable at least one domain. Flat authorization objects are rejected.

## Organization authorization

Add the second domain independently:

```yaml
authorization:
  organizations:
    enabled: true
    mode: multiple
    roles: [owner, editor, viewer]
    ownerRole: owner
    defaultRole: viewer
    rolePermissions:
      editor: [note:read, note:write]
      viewer: [note:read]
```

When organizations are enabled, every protected endpoint must explicitly declare `scope: global` or `scope: organization`. An organization endpoint requires an active membership selected by `x-organization-id` or the verified session's active organization. Missing or inactive membership returns `403` with `code: "TENANT_MEMBERSHIP_REQUIRED"`. A global administrator never bypasses this check or supplies organization permissions.

Organization operations establish tenant ownership for their entities and related records. Generated tables add a server-owned `organizationId`; unique keys and indexes include it. All operations on these records must use organization scope. Generated use cases pass the immutable verified context's organization ID as the first repository parameter, and reads, mutations, joins and declared relation checks use explicit organization conditions. Do not declare `organizationId` as a client field. Scalar UUIDs crossing module boundaries still require an explicit public application call for business ownership validation.

Each organization has its own `auth_org_roles` and `auth_org_role_permissions` catalog. YAML roles seed that catalog only when the organization is created. Companies can create roles, edit grants and descriptions, and delete unassigned ordinary roles without deployment. The owner keeps its contextual wildcard; the default role cannot acquire organization administration permissions. Neither system role can be deleted, and changes cannot remove the last active administrator. Administrative losses require the same state-bound confirmation flow as global IAM.

Single global roles use `auth_user.role`. Multiple global roles use `auth_user_roles`; multiple organization roles use `auth_member_roles`. Associations have composite keys and foreign keys; organization role associations cannot reference another company's roles. Role assignments execute in request-scoped PostgreSQL transactions. Context permission sets provide constant-time membership checks, and the frontend query identity includes sorted roles, permissions and the organization ID. Switching organizations verifies membership on the server and reloads the workspace so private caches and pending chat approvals cannot cross companies.

Better Auth configuration and static routes are reused through a bounded cache keyed by scalar environment settings, including credential rotation. Session rows, memberships, principals and grants remain request-scoped and are revalidated. AsyncLocalStorage keeps asynchronous audit work attached to its own request's execution context even when requests overlap; generated Workers retain their Node compatibility flag.

The header selector creates or activates a company. `/organization/settings/members` paginates members, sends invitations, assigns one or several roles, and removes members. `/organization/settings/roles` manages the company catalog. Access requires `org:members:manage` or `org:roles:manage` inside that company; `/admin/*` continues to require global IAM capabilities. Invitation links use the first trusted frontend origin different from `BETTER_AUTH_URL`; configure `AUTH_TRUSTED_ORIGINS` accordingly, along with the existing email delivery settings. Acceptance verifies the signed-in email, expiration and a single-use hashed secret.

The conditional Better Auth organization integration provides organization/session metadata. Its native `/organization/*` endpoints are blocked: use `/api/auth/iam/organizations` and its generated administration endpoints so dynamic roles, membership and last-administrator protections apply. The custom API includes `POST /active`, `GET /members`, `POST /members/:id/roles`, `POST /members/:id/remove`, role CRUD, `POST /invitations`, and `POST /invitations/accept` beneath that prefix. Mutations require a trusted Origin. Custom SQL and account deletion must preserve the same invariants.

Database seeds skip tenant records until an existing organization is explicitly selected with `NORDIXGEN_SEED_ORGANIZATION_ID` or `seedDatabase({organizationId})`. Initialization never invents tenants, owners or privileged accounts.

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
| `POST /users/:id/role` | User-role management; body `{ "role": "editor" }` in single mode or `{ "roles": ["editor", "auditor"] }` in multiple mode |
| `GET /audit` | Role management; [audit queries](AUDIT_LOGGING.md) |

Every mutation requires a trusted Origin. Responses are not cached. Invalid identity returns 401; insufficient grants return 403. Frontend visibility is not authorization.

## Administrative safeguards

Role/grant/assignment changes are serialized in database transactions and recheck the actor's current capability. A change removing the last full IAM administrator returns `409` with `code: "last_admin"`; assign another full administrator first.

Changes that remove administrative access from assigned accounts may return `409` with `code: "confirmation_required"` and an impact token. Review the affected accounts/capabilities, then resubmit the same mutation with `confirmation` set to that token. Changed state requires a new review. Confirmation never grants authorization.

Successful IAM changes are [audited](AUDIT_LOGGING.md) after commit. These protections cover IAM routes; direct SQL or custom account-deletion code must preserve equivalent safeguards.

Tenant isolation uses explicit application/repository parameters, without PostgreSQL RLS or hidden driver filters. Arbitrary ABAC rules and cross-tenant impersonation remain application concerns. AI tools declare the same scope; custom tools must choose a scope when organizations are enabled. Chat ownership includes the active organization, and API-key grants only restrict the current grants within each domain.

## Reproduce performance verification

Use `examples/performance/project.yaml` and an explicitly isolated PostgreSQL test database behind the local Neon proxy. With `NORDIXGEN_TEST_DATABASE_URL` configured as described in the persistence tests, run `pnpm benchmark:authorization`. The command resets only the named test database, generates the stack and migrations, and seeds 1,001 users, 1,000 active fixture sessions, 50 organizations and 10,000 relational business records. It compares global single-role authorization against organization single/multiple roles under 20–50 concurrent requests, measures concurrent role mutations, and writes p50/p95/p99/throughput/error results under `tmp/authorization-128/`. The scorecard enforces zero errors and a maximum 20 ms p50/p95 increase for principal resolution and IAM over the paired local baseline. Local results are not directly comparable to the historical deployed Cloudflare latency measurements.
