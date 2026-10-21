# Troubleshooting

Start with the failing command or user action. Use the generated project's README for its exact paths and environment values.

## Generation

| Problem | What to check |
| --- | --- |
| Configuration rejected | Use `schemaVersion: 2`; follow the reported path and [validation guide](configuration/VALIDATION.md) |
| Scaffold/install fails | Node 24+, pnpm, Git author identity and network access; retry in an empty target after fixing the cause |
| Database ownership error | One dedicated resource per persisted backend; consolidate modules or declare separate databases |
| Missing CRUD action | Declare its endpoint; ambiguous bindings can suppress automatic actions while keeping typed clients/Explorer available |

## Local application

| Problem | What to check |
| --- | --- |
| Database scripts cannot connect | Set `DATABASE_URL` in the Node shell; `.dev.vars` alone is not enough |
| API cannot be reached | Frontend internal backend URLs, ports and same-origin proxy; cloud uses private bindings |
| Docker port collision | Repository `.env` overrides; debug override for backend host ports |
| Split frontend starts before backend | Start the first backend repository to create the shared private bridge |
| Failed/pending local seed | Inspect failure and database contents; do not blindly retry or delete valuable volumes |

## Identity and access

| Problem | What to check |
| --- | --- |
| Login succeeds but page redirects | Correct identity authority, `BETTER_AUTH_URL`, cookies and one hostname; do not mix localhost/127.0.0.1 |
| 401 response | Missing, invalid or expired identity |
| 403 response | Current database grants or trusted Origin; a visible button does not grant permission |
| YAML grant changes have no effect | Existing roles are preserved; update through IAM |
| Email/SMS missing | Backend delivery secrets and production mode; local Mailpit/console is simulation |
| SMS remains blocked after restart | Persisted quota/cooldown; failed delivery still consumes a reserved attempt |

## Integrations

| Problem | What to check |
| --- | --- |
| Chat provider error | Backend provider key, detection order and available `AI_MODEL` |
| MCP cannot connect | Gateway `/mcp`, exact `MCP_PUBLIC_URL`, credentials and owner/key grants |
| New tool absent | Direct exported `defineTool` in `*.tool.ts`; restart discovery and assign capability |
| R2 direct upload fails | Exact upload CORS, scoped signing credentials, 100 MiB bound; local Miniflare lacks automatic cloud signing |
| Split storage binding missing | Deploy infrastructure owner before consumers |
| Infrastructure locked/partial | Inspect state and active builds before retrying/removing a stale lock |
| Audit event absent | Endpoint opt-in, migrations and backend logs; background capture is best effort |

When reporting a bug, include tool versions, revision, a small sanitized configuration, the failing stage and expected/actual behavior. Do not include credentials or signed links. Mention application customizations and whether fresh output reproduces the behavior.
