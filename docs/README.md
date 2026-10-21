# NordixGen documentation

NordixGen initializes ordinary, editable client applications from strict YAML v2. This directory documents the generator and its output. Paths such as `src/platform/` refer to a generated application unless a guide explicitly says otherwise. Commands for generated applications run in that application's directory; generator commands run in this checkout.

## Start with your task

| Task | Read |
| --- | --- |
| Generate and run a first project | [Getting started](GETTING_STARTED.md) |
| Find a feature, its configuration and its limits | [Capability map](CAPABILITIES.md) |
| Edit configuration | [YAML v2 reference](configuration/YAML_V2.md), then [validation and diagnostics](configuration/VALIDATION.md) |
| Add business behavior after generation | [Extending a generated project](EXTENDING_PROJECTS.md) |
| Configure login, delivery and the first administrator | [Authentication setup](generation/AUTHENTICATION.md) and [identity/IAM](generation/IDENTITY_ACCESS.md) |
| Add chat, external AI clients or custom tools | [AI and MCP](generation/AI_MCP.md) |
| Run Docker or configure staging/production | [CLI workflow](generation/CLI_WORKFLOW.md) and [deployment](DEPLOYMENT.md) |
| Manage buckets, documents and infrastructure changes | [R2 infrastructure](INFRASTRUCTURE.md) |
| Diagnose setup or runtime failures | [Troubleshooting](TROUBLESHOOTING.md) |
| Change NordixGen itself | [Contributing](CONTRIBUTING.md) |

## Technical references

| Area | Reference |
| --- | --- |
| Product intent and supported system shape | [Specification](SPECIFICATION.md) |
| Parsing, resolution, scoped views and type mapping | [Resolved model](configuration/RESOLVED_MODEL.md), [core package](../packages/core/README.md) |
| Generation stages and command effects | [CLI workflow](generation/CLI_WORKFLOW.md), [CLI package](../packages/cli/README.md) |
| Backend renderers, architecture families and dependencies | [Direct backend](generation/DIRECT_BACKEND.md), [module ownership](generation/CLEAN_MODULES.md) |
| Typed module imports, trusted context and error handling | [Public module communication](generation/PUBLIC_MODULES.md) |
| Frontend generation, state and design tokens | [Direct frontend](generation/DIRECT_FRONTEND.md) |
| Clients, forms, filtering, pagination and query isolation | [API screens](generation/API_SCREENS.md) |
| Server page access and identity authority | [Frontend access](generation/FRONTEND_ACCESS.md) |
| Audit capture, inspection and delivery limits | [Audit logging](generation/AUDIT_LOGGING.md) |

## Which document is authoritative?

The YAML reference defines accepted configuration and defaults. The validation guide identifies unsupported generation mappings and test evidence. Task guides explain how to use those capabilities; the specification describes product intent and may discuss broader goals. The capability map explicitly separates implemented behavior from limits. There is no maintained `IMPLEMENTATION_PLAN.md`; use these documents rather than a historical implementation plan.

Each generated repository has its own README and `docs/DEPLOYMENT.md` and `docs/DISASTER_RECOVERY.md`, with commands and paths for that particular project. Those emitted files are distinct from this repository's guides. After initialization, maintain them alongside the application code.

Documentation is maintained in English. New features should update their configuration reference, usage instructions, operational limitations and this index where necessary. Source-code localization outside Markdown remains a separate concern; see the [contributor guide](CONTRIBUTING.md).
