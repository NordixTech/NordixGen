import { readFile } from "node:fs/promises";
import { type ResolvedProject, cloudflareWorkerName } from "@nordix-tech/nordixgen-core";
import type { DeploymentManifest } from "./deployment-model.js";
import { infrastructureFiles, infrastructureManifest } from "./infrastructure.js";

type Repository = ResolvedProject["repositories"][number];
export const deploymentScripts = {
  "cicd:setup": "node scripts/cicd.mjs setup",
  "cicd:build": "node scripts/cicd.mjs build",
  "cicd:deploy": "node scripts/cicd.mjs deploy",
};
export function deploymentManifest(
  project: ResolvedProject,
  repository: Repository,
): DeploymentManifest {
  return {
    version: 1,
    project: project.project.name,
    repository: repository.name,
    infrastructure: infrastructureManifest(project, repository.name),
    publicFrontends: Object.fromEntries([
      ...Object.values(project.frontends).map((app) => [
        app.name,
        {
          worker: cloudflareWorkerName(project.project.name, app.name),
          connections: [...app.connections],
          identityBackend: app.identity?.backend,
        },
      ]),
      ...Object.values(project.backends)
        .filter((app) => app.ai?.mcp.enabled)
        .map((app) => [
          `${app.name}-mcp`,
          {
            worker: cloudflareWorkerName(project.project.name, `${app.name}-mcp`),
            connections: [app.name],
          },
        ]),
    ]),
    applications: [
      ...Object.values(project.backends)
        .filter((app) => app.repository.name === repository.name && app.ai?.mcp.enabled)
        .map((app) => ({
          name: `${app.name}-mcp`,
          path: `${app.path}/mcp-gateway`,
          worker: cloudflareWorkerName(project.project.name, `${app.name}-mcp`),
          kind: "gateway" as const,
          database: false,
          identity: false,
          connections: [app.name],
          runtimeKeys: [],
        })),
      ...Object.values(project.backends)
        .filter((a) => a.repository.name === repository.name)
        .map((a) => ({
          name: a.name,
          ...(a.ai?.mcp.enabled ? { mcpGateway: `${a.name}-mcp` } : {}),
          ...(a.ai ? { ai: true } : {}),
          path: a.path,
          worker: cloudflareWorkerName(project.project.name, a.name),
          kind: "backend" as const,
          database: Boolean(a.database),
          identity: Boolean(a.identity),
          storage: [...a.storage],
          connections: [],
          runtimeKeys: [
            ...(a.identity?.identityProviders.includes("microsoft") ? ["MICROSOFT_TENANT_ID"] : []),
            ...(a.identity?.methods.includes("phone-number")
              ? ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER"]
              : []),
            ...(a.identity?.identityProviders.flatMap((p) => [
              `${p.toUpperCase()}_CLIENT_ID`,
              `${p.toUpperCase()}_CLIENT_SECRET`,
            ]) ?? []),
          ],
          emailDelivery: Boolean(
            a.identity?.methods.includes("email-password") ||
              a.identity?.allowedEmailDomains?.length ||
              a.identity?.features.some(
                (f) => f === "email-verification" || f === "password-recovery",
              ),
          ),
        })),
      ...Object.values(project.frontends)
        .filter((a) => a.repository.name === repository.name)
        .map((a) => ({
          name: a.name,
          path: a.path,
          worker: cloudflareWorkerName(project.project.name, a.name),
          kind: "frontend" as const,
          database: false,
          identity: Boolean(a.identity),
          identityBackend: a.identity?.backend,
          connections: [...a.connections],
          runtimeKeys: [],
        })),
    ],
  };
}
export async function deploymentFiles(
  project: ResolvedProject,
  repository: Repository,
): Promise<Record<string, string>> {
  // The standalone bundle contains its dependencies; generated projects do not need NordixGen installed.
  const bundle = new URL(
    import.meta.url.includes("/src/") ? "../dist/cicd-assistant.js" : "./cicd-assistant.js",
    import.meta.url,
  );
  return {
    "scripts/cicd.mjs": await readFile(bundle, "utf8"),
    "nordixgen.deployment.json": `${JSON.stringify(deploymentManifest(project, repository), null, 2)}\n`,
    "docs/DEPLOYMENT.md": deploymentDocumentation(project, repository),
    "docs/DISASTER_RECOVERY.md": recoveryDocumentation,
    ...(project.iac && Object.keys(project.iac.cloudflare.r2_storage).length
      ? { "docs/INFRASTRUCTURE.md": infrastructureDocumentation }
      : {}),
    ...(await infrastructureFiles(project, repository.name)),
  };
}
export const deploymentReadme = [
  "## CI/CD configuration with database",
  "",
  "Git is initialized on `main` with the generated project committed; `develop` starts at the same commit. Remote creation is optional. Before configuring CI/CD, publish both branches to GitHub.",
  "",
  "### Option 1 — Guided CLI assistant",
  "",
  "Run `pnpm cicd:setup` from this repository root. Choose the Neon project/region and the Cloudflare backend location independently; the assistant marks the location matching Neon and shows both choices before applying. It prepares Neon staging, uploads runtime/build secrets, and configures native Cloudflare push triggers. Read the prerequisites in [the deployment guide](docs/DEPLOYMENT.md) first. Use `pnpm cicd:setup --profile client-name` to configure another account without changing the application code.",
  "",
  "### Option 2 — Manual setup",
  "",
  "Follow [the deployment guide](docs/DEPLOYMENT.md): create Neon branches, configure secrets, deploy each Worker, and connect `develop` to staging and `main` to production in Cloudflare. Both options use the same generated build/deploy commands and require no GitHub Actions runners.",
  "",
  "Keep Better Auth in the generated backend; Neon Managed Auth is not used. See [disaster recovery](docs/DISASTER_RECOVERY.md) for Neon PITR.",
  "",
];
export function deploymentDocumentation(project: ResolvedProject, repository: Repository): string {
  const manifest = deploymentManifest(project, repository);
  return `# Cloudflare native CI/CD with Neon

## Deployment contract

| Git branch | Application environment | Neon branch |
| --- | --- | --- |
| develop | staging | staging |
| main | production | main |

One persistent Worker per application/environment. Feature branches do not deploy through these triggers. Staging is not an ephemeral Preview. A Git merge applies committed migrations; it never copies or merges staging database data into production. Each persisted backend owns a dedicated Neon project/database resource. Backend-only, frontend-only repositories and monorepos use the same root commands below. Configure a split backend repository first. Frontends bind to the stable backend Worker names; no public backend URL is required.

${
  manifest.applications.some((app) => app.ai)
    ? `## AI chat and MCP

AI provider secrets belong on the backend Worker only. Set one of OPENAI_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY or GROQ_API_KEY (selection follows that priority), and optionally AI_MODEL. Without any key, chat returns a descriptive 400 while MCP/domain tools remain usable. Do not put these credentials in build output, browser variables or the gateway.

${manifest.applications
  .filter((app) => app.mcpGateway)
  .map(
    (app) =>
      `- Backend ${app.name} stays private. Deploy gateway ${app.mcpGateway} from ${app.path}/mcp-gateway with its own staging/production Workers Builds triggers and public origin. Its Service Binding names the corresponding private backend Worker. Set backend MCP_PUBLIC_URL to that gateway origin; preserve BETTER_AUTH_URL for the frontend session authority (use the gateway origin in API-only deployments). Publish the backend before routing production traffic through the gateway.\n- For ${app.name}, local MCP development can run Wrangler with both configuration files, or the generated Docker gateway on loopback port 8790. Override MCP_${app.name.toUpperCase().replaceAll("-", "_")}_PORT and ${app.name.toUpperCase().replaceAll("-", "_")}_MCP_PUBLIC_URL together. The gateway exposes only MCP and OAuth onboarding routes; it does not publish general business routes.`,
  )
  .join("\n")}

Connect external clients to the gateway /mcp URL. OAuth starts from the MCP client so it owns PKCE and state. The portal (/connect-ai when generated) also creates scoped, expiring personal keys and provides revocation. API keys use x-api-key or Authorization: Bearer; never put credentials in a URL. WAF rules and custom domain routes are explicit Cloudflare account configuration.

Custom backend tools are exported variables initialized with defineTool in src/**/*.tool.ts. predev/pretypecheck/prebuild discover these files; restart dev after adding a file. Both chat and MCP use the shared registry and current IAM grants. With mutation confirmation enabled, the chat shows approval cards; MCP publishes destructiveHint and requires confirm:true, with interactive approval managed by the external client.

`
    : ""
}

## Prerequisites for both options

- Node.js 24, pnpm 10.5.2, dependencies installed, GitHub CLI authenticated with access to the remote repository.
- Publish both official branches: \`git remote add origin <your-repository-url>\` (if needed), then \`git push --atomic --set-upstream origin main develop\`. For a new remote, set its default branch to main in GitHub.
- Authorize the Cloudflare Workers and Pages GitHub App for the repository in Cloudflare Settings > Builds > Connect. For a newly created private repository, open https://github.com/settings/installations, configure Cloudflare Workers and Pages and add the repository if access is restricted to selected repositories. This browser authorization is required once; an API token cannot grant GitHub App access.
- Workers Builds needs a registered deployment credential. The assistant can register the same user API token you supply for setup; you do not need to create another token. An existing registered build token is an optional advanced choice.
- A Cloudflare user API token scoped to the target account: Workers Scripts Edit, Workers Builds Configuration Edit, Account Settings Read; Workers Routes Edit and Zone Read when managing custom routes. ${manifest.infrastructure ? "This project declares R2: also grant Account > Workers R2 Storage > Edit and User > API Tokens > Edit/Read (or Account > Account API Tokens > Edit/Read for account-owned R2 credentials). Enable R2 Object Storage in the dashboard before setup. The assistant reuses the setup token for state, infrastructure and PR reviews; only backend transfer-signing credentials are separately bucket-scoped. Public custom domains require Zone Read for the domain zone." : "No additional R2 permissions are required because this project declares no infrastructure."} The Builds API currently requires a user token, not an account-owned token.
- For assistant-managed Neon creation/branch setup, a Neon API key with access to the intended organization/project. A project-scoped key can manage existing branches but cannot create a new project. No Neon administrative API key is stored in builds or Workers.

## First-time account access (no existing integration required)

1. **GitHub:** install the GitHub CLI from https://cli.github.com and run gh auth login. Choose GitHub.com and browser authentication. Publish main and develop to your repository before setup.
2. **Cloudflare setup token:** open https://dash.cloudflare.com/profile/api-tokens. Navigate to My Profile > API Tokens > Create Token > Create Custom Token. Name it NordixGen setup. Add Account Settings / Read, Workers Scripts / Edit, and Workers Builds Configuration / Edit under Account permissions. Limit Account Resources to the target account. Create the token and copy its secret into the assistant's masked prompt. Do not use the Global API Key.
3. **Cloudflare GitHub authorization:** open https://dash.cloudflare.com, select your account > Workers & Pages > a Worker > Settings > Builds > Connect > GitHub. If the account has no Workers, create a temporary Hello World Worker to reach this screen. Authorize Cloudflare Workers and Pages for the repository owner. If using Only select repositories, select this repository. Review the installation at https://github.com/settings/installations. An API token cannot grant this browser authorization. The assistant checks repository connection access when applying configuration, before creating Neon projects.
4. **Automatic deployments:** choose Use the API token I already entered in the assistant. After you confirm the configuration, it registers that same token with Cloudflare Workers Builds. Cloudflare retains the credential so builds can deploy after a push without your computer. No second API token is created, and no token is stored in Git or the public profile. Revoking this token also stops automatic deployments. Advanced users can select an existing registered build token. For fully manual configuration, select or register your API token under Worker > Settings > Builds > API token. A temporary onboarding Worker can be removed after setup; retain the credential selected for your applications.
5. **Cloudflare workers.dev address:** under Workers & Pages, finish the first-time workers.dev subdomain registration if prompted. The generated demo uses that account subdomain for its public URLs.
6. **Neon API key:** open https://console.neon.tech, sign in, then open the profile menu > Settings (or Account settings) > API keys. Create a personal key named NordixGen setup and copy its secret into the masked prompt. Use a personal key with organization access to create new projects. No Neon-to-GitHub integration is required. See https://neon.com/docs/manage/api-keys for the current Console navigation.

The assistant displays these instructions during setup. Existing shell credentials are offered explicitly and default to not being reused. Invalid or revoked credentials show a retry prompt. Tokens remain in memory and are not saved in public profiles. A browser confirmation alone is not proof of repository access: the provider connection must also succeed. If it fails, follow the displayed authorization instructions and rerun setup.

## Option 1: guided CLI

Run from this repository root:

\`\`\`sh
pnpm cicd:setup
# Separate public destination profile for another account:
pnpm cicd:setup --profile other-client
\`\`\`

With your explicit confirmation, tokens can be provided through \`CLOUDFLARE_API_TOKEN\` and \`NEON_API_KEY\` in the local shell, or entered in masked prompts. They are never stored in a profile or manifest. Do not paste credentials into command arguments or Git. Profiles in ignored \`.nordixgen/\` contain destination IDs and URLs only. Keep any environment configuration files outside Git too.

The assistant lists Cloudflare accounts, detects the GitHub remote and proposes workers.dev origins. By default it offers to reuse your supplied API token for deployment, registering it with Cloudflare Workers Builds only after you confirm. It verifies the token and reuses an existing registration when available; choosing a separately registered token is optional. For each persisted backend, create a new Neon project by selecting its organization and region, or select an existing project from the list. Project names are human-readable labels; Neon assigns separate internal IDs such as red-breeze-12345678. The assistant displays both and uses the ID automatically, so you never need to type it. Saved projects are checked before being offered for reuse. The project is created with root branch main and a persistent staging child with plan-default scale-to-zero enabled (normally 300 seconds). Existing main must already be a root; an existing staging must be its direct child. Existing databases are never reset or deleted. The assistant obtains each connection, configures separate runtime/build secrets and upserts named push triggers. It bootstraps new Workers with a 503 response until a real build succeeds. Public profiles are saved before subsequent steps so a failed setup can resume.

For an existing deployment, reuse its BETTER_AUTH_SECRET when asked. Entering \`generate\` deliberately rotates that environment's secret and may invalidate sessions. Keep production and staging secrets different. OAuth credentials and email configuration are prompted only when those features were generated.

For each persisted backend, setup shows the chosen Neon region and asks independently for the Cloudflare backend location. The selector offers compatible AWS/GCP/Azure region references from the Neon region catalog, marks the matching database region, and also offers Smart Placement. Cloudflare runs in its own nearby data center, not inside the selected cloud provider. Existing Neon projects keep their region; choosing another Worker region never migrates database data. The choice applies to staging and production, whose database branches share a project region. Frontends and MCP gateways keep their edge location.

Placement is stored with the ignored local profile and in each backend Workers Builds trigger as the public build variable \`NORDIX_WORKER_PLACEMENT\` (for example \`aws:us-east-1\`, \`gcp:us-central1\`, or \`smart\`). Setup updates the corresponding environments in the backend's \`wrangler.jsonc\`; build and deploy reapply the variable, so a fresh Git checkout preserves the choice without the local profile. Other environments, storage bindings and access controls are preserved. Without that variable, existing Wrangler placement is retained. For manual CI, set this build variable for each backend or edit its environment placement directly; select only one placement strategy. Rerun setup to change the choice and deploy through the normal push workflow.

After setup, push a new commit to develop and inspect its native Cloudflare build. Then merge into main and check production. Setup configures triggers; it does not claim that an application has passed a live deployment.

## Option 2: manual setup

1. Create a Neon project for each persisted backend. Name its root branch main (the Console may initially call it production). Create staging once as a child of main, with its own read-write compute. Copy a direct PostgreSQL connection for each branch/database/owner role. Configure compute scale-to-zero for staging. Suspended compute does not consume CU-hours, but storage/history and any excess-branch charges still apply.
2. Review committed SQL in each backend's \`drizzle/\`. The generator creates migrations; do not run schema generation or seeds during deployment. Optional IAM bootstrap is already part of db:migrate and does not overwrite edited grants.
3. Configure the environment matrix below. Runtime secrets go to the matching Worker Settings > Variables and Secrets. Build secrets go to Settings > Builds > Variables and Secrets. DATABASE_URL is needed in both places. Frontend-to-backend communication uses private service bindings; no NEXT_PUBLIC backend URL is needed. R2 signing secrets belong only to backend runtime, not frontend or application build variables. Never set NODE_ENV=production before installing dependencies: typechecking and migrations need devDependencies.
4. In the Cloudflare dashboard, create a placeholder Worker for each exact environment name from the application wrangler.jsonc (Start with Hello World is sufficient). Add its required runtime values under Settings > Variables and Secrets. This avoids building OpenNext on your workstation. The assistant performs this placeholder step automatically with a 503 response. Optional local bootstrap uses the application commands below, local Wrangler authentication and shell DATABASE_URL for backend migrations; run frontend builds in Linux/WSL/Docker if Windows symlink permissions prevent standalone output.
5. In Cloudflare, connect the repository separately to each environment Worker. Set build root to \`/\` (repository root, where the pnpm lockfile and cicd commands live), NODE_VERSION=24 and PNPM_VERSION=10.5.2. Use the table commands. Select develop for the staging Worker and main for production. Disable other branch/Preview builds. Use the exact environment Worker name from its wrangler.jsonc.
6. Push develop, inspect build status/logs and test its URLs. Then push/merge main and repeat. A migration failure must stop publishing. Use additive/backward-compatible migrations: the previous application can still serve traffic while migration/build/deploy runs. Separate application builds are not an atomic release across a monorepo.

| App | Directory | Build command at repository root | Deploy command at repository root |
| --- | --- | --- | --- |
${manifest.applications.map((a) => `| ${a.name} | \`${a.path}\` | \`pnpm cicd:build ${a.name} staging\` | \`pnpm cicd:deploy ${a.name} staging\` |`).join("\n")}

Repeat each row replacing staging with production. The same commands work in a shell for manual bootstrap. Backend build runs typecheck, check:boundaries and (if persisted) db:migrate. Frontend build runs typecheck and OpenNext build; deploy publishes the resulting Worker. Backend builds without a database skip migrations. WORKERS_CI_BRANCH is checked to reject deployment to the wrong environment.

## Environment values

| Value | Where | Meaning |
| --- | --- | --- |
| DATABASE_URL | Persisted backend runtime + build secret | Corresponding Neon branch; different staging/production connections |
| BETTER_AUTH_SECRET | Authenticated backend runtime secret | At least 32 random characters; independent per environment |
| BETTER_AUTH_URL | Authenticated backend runtime | Public frontend origin; Better Auth remains in the private backend |
| AUTH_TRUSTED_ORIGINS | Authenticated backend runtime | Exact allowed frontend origins, comma separated |
| CORS_ALLOWED_ORIGINS | Backend without auth, runtime | Exact allowed frontend origins, comma separated |
| BACKEND_<NAME>_INTERNAL_URL | Frontend local server only | Local HTTP fallback for next dev / Docker; never emitted into browser code |
| Provider CLIENT_ID / CLIENT_SECRET, RESEND_API_KEY, AUTH_EMAIL_FROM | Backend runtime, when generated | Existing Better Auth OAuth and email features |

## Authenticated browser topology

The browser calls this frontend's /api/backend/<backend>/* BFF routes, /api/auth/* and /api/auth/iam/*. Server components/session checks call the selected Service Binding directly. The backend has workers_dev=false, preview_urls=false and no public routes. All environment bindings are explicit and independent. Session cookies and multiple Set-Cookie headers cross the BFF without entering browser state; OAuth callbacks use the frontend /api/auth/* endpoint. BETTER_AUTH_URL is the frontend origin, not a public backend URL. AUTH_TRUSTED_ORIGINS must contain the exact frontend origins. No custom domain is required to make authentication work on a frontend workers.dev URL.

For native local development, start the backend and configure BACKEND_<NAME>_INTERNAL_URL in the frontend's .env.local. next dev can use HTTP locally. For a local standalone production build, explicitly set NORDIX_LOCAL_RUNTIME=1. Production Cloudflare has no HTTP fallback when a service binding is missing. Direct R2 presigned downloads are the intentional browser-to-R2 exception.

## Change accounts and retry

Use a new profile, supply credentials for the new Cloudflare account, authorize GitHub there, and recreate the same Worker/build configuration. Supply the existing Neon project to retain data or a transferred/replaced project explicitly. Changing a token does not move Workers, domains or database data. Deploy and verify staging first, then production; move DNS/routes after verification and disable old build triggers so subsequent pushes do not deploy to both accounts unintentionally. Old resources are not automatically deleted. Profiles do not migrate data or custom domains. On failure review resources in the dashboards and rerun with the saved profile; named triggers and existing branches are reused. Re-running writes runtime/build values again; preserve auth secrets. A project transferred between Neon organizations may require a new project-scoped API key.

## Verification and costs

Check /api/backend/<backend>/health through the frontend and confirm the backend workers.dev URL is inaccessible; render each frontend, run a generated business list/create operation to verify migrations, and test sign-up/login, protected server navigation and logout if auth is enabled. Verify separate data in staging and production. Confirm main pushes never change staging and develop pushes never change production. Keep credentials out of screenshots and build logs. Record the tested commit and provider build IDs.

Zero GitHub Actions minutes does not mean unlimited free Cloudflare builds. Neon Launch is usage-based; its displayed typical spend is an estimate. Configure the available restore history for your plan, see [disaster recovery](DISASTER_RECOVERY.md). No off-site R2 backups are implemented here.

References: [Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/), [environment Workers](https://developers.cloudflare.com/workers/ci-cd/builds/advanced-setups/), [Builds API](https://developers.cloudflare.com/workers/ci-cd/builds/api-reference/), [OpenNext](https://opennext.js.org/cloudflare/get-started), [Neon branching](https://neon.com/docs/manage/branches).
`;
}
export const recoveryDocumentation = `# Disaster recovery — Neon PITR (Defense Line 1)

## Configure and rehearse

Keep a dedicated production root branch main and a persistent staging child. In Neon project Settings > Postgres, configure the history window (applies to the project, not just main). Current plan maxima: Free 6 hours (up to 1 GB of history), Launch 7 days, Scale 30 days. Launch/Scale default to 1 day; choose 7 days for production when available and budget for history storage. Scale-to-zero saves compute, not storage/history charges. Do not confuse metrics/log retention with database restore history.

## Incident procedure

1. Stop faulty deployments and pause application writes if required. Record UTC incident time, deployed commit, affected project/root branch and current connection settings. Preserve evidence and the current state. Restoring the entire database also rewinds user/session/role data; account for valid writes since the recovery point.
2. Choose an exact RFC3339 UTC time before the error, within the available restore history. Prefer Neon Console instant restore; its preview lets you inspect the intended state. For CLI operations pin and inspect the installed Neon CLI version and its help before use. Never run recovery commands from an unreviewed timestamp.
3. Safer investigation path: create a recovery branch at that historical point via Console, verify schema/data, obtain its connection, apply any necessary compatible application rollback and switch production DATABASE_URL in BOTH runtime secrets and build secrets. Do not let the next faulty deployment immediately apply the destructive migration again. New branch means a new endpoint/connection; changing a branch's name alone does not repoint application traffic.
4. Alternatively restore main in place using Console instant restore, preserving the prior state as a backup branch. The documented modern CLI form is \`neon branches restore main ^self@<UTC_TIMESTAMP> --preserve-under-name main-before-recovery --project-id <PROJECT_ID>\`. Quote the source argument in your shell if needed. In-place restore retains connection details but temporarily interrupts existing connections. It is not a guaranteed zero-downtime operation.
5. Verify backend /health AND business reads/writes against the restored database, authentication, roles and critical records. Confirm production uses the intended branch and that staging is unaffected. Re-enable writes and controlled deployments only after verification. Retain the backup branch for reconciliation, then remove it only through an explicit operational decision.

## Recovery objectives

The issue targets RPO <1 second and RTO <2 minutes. These are goals to measure in a rehearsal, not a provider guarantee: detection/decision time, timestamp selection, reconnects, secret changes, application rollback and lost valid writes all affect recovery. Record incident time, recovery point, actual lost writes and time until verified service restoration. Do not claim the target is achieved until measured.

PITR is not an off-site backup. Defense Line 2 (logical exports to Cloudflare R2) remains out of scope. Never store real connection strings, recovery tokens or customer data in this runbook.

References: [Neon history window](https://neon.com/docs/postgres/backup-restore/history-window), [instant restore](https://neon.com/docs/postgres/backup-restore/branch-restore), [Neon CLI](https://neon.com/docs/cli/branches).
`;

export const infrastructureDocumentation =
  "# Infrastructure lifecycle\n\nThe generation YAML has already served its purpose. Edit the committed OpenTofu .tf files in infra/terraform/ after generation; no NordixGen installation or original YAML is required. OpenTofu is downloaded from its pinned official release and its checksum is checked, or use an installed 1.11+ binary via TOFU_BIN. Commit .terraform.lock.hcl after initialization; never commit state, plan files or credentials.\n\n## Setup and credentials\n\nEnable R2 in the Cloudflare dashboard. The cicd:setup token needs Workers R2 Storage Edit and API Tokens Edit/Read in addition to the ordinary deployment permissions. User token management and account-owned token management are supported; transfer keys are scoped to their buckets and environment. The assistant masks inputs and never saves credentials in Git/public profiles. Workers Builds retains infrastructure credentials for automatic pushes. Runtime transfer signing credentials go only to consuming backends; frontends and PR plans do not receive them. A GitHub token with repository read and pull-request comment write access is required; the authorized GitHub CLI credential can be used. Administrators should control production access. Secret storage does not prevent someone who can deploy arbitrary production code from reading runtime data.\n\nThe assistant creates/reuses a private R2 state bucket, separate from application resources. State and signing identifiers are namespaced by project/environment in that account. Rerunning with the same account/profile resumes. Switching accounts creates separate infrastructure; it does not migrate application files. Back up state independently; R2 state storage must not be mistaken for object versioning or a data backup service.\n\n## Changes and native builds\n\nEach official-branch build applies infrastructure before publishing the application. A shared lock and commit marker coordinate concurrent application builds; an older queued commit must not overwrite newer infrastructure. OpenTofu refreshes provider state on each new commit. No-change plans do not recreate resources. Genuine provider/permission/migration errors still fail deployment.\n\nPR builds run plan only and update a comment with the target environment, commit, resource actions and bucket empty/nonempty/unknown status plus check time. Raw state, object keys, file contents and secrets are not published. The report is informational: merging applies additions, updates and removals automatically without an approval file or command. Removal/replacement of a bucket empties it and permanently deletes its objects. Renaming a bucket does not migrate its files. New writes may arrive after the PR check. Perform a separate migration/backup before merging if data must survive.\n\nOnly resources explicitly present in the saved destructive plan are emptied; the state bucket cannot be targeted by this cleanup. An interrupted apply can leave partial infrastructure; retry after inspecting the failure. If a build is terminated while holding apply.lock, verify no apply is running before removing that lock. Never unlock an active operation.\n\n## Adding or sharing R2\n\nAdd a cloudflare_r2_bucket resource to a .tf file and add its binding/bucket/public_url to the storage output for each consuming backend. A bucket may be shared by multiple backends. Keep staging and production naming separate. The outputs drive Wrangler bindings, public URL metadata and scoped signing permissions; infrastructure has one owning repository (iac.repository, default first repository). Split consumers read the shared outputs; deploy the owning repository before consumers when introducing resources. Use only one owner/state address per shared resource.\n\nPrivate is the default. Public resources require public_domains entries (domain and zone_id) in each environment's tfvars and create a custom domain, not a production r2.dev URL. Add explicit CORS origins when fetching presigned objects from browser JavaScript. Browser navigation downloads do not require a cross-origin fetch. Never store private user documents in a public bucket.\n\n## Application storage\n\nApplication code depends on StoragePort in src/application/ports/storage-port.ts. The platform factory creates native R2 adapters and the module composition supplies them as storage dependencies. Call the port only after existing session/permission and object-ownership checks. Infrastructure declaration alone intentionally does not publish an unrestricted file HTTP endpoint.\n\ndownloadStream returns a stream for authenticated responses through the frontend BFF. getSignedUrl returns a short-lived S3 GET URL (default 300 seconds, maximum 7 days); anyone possessing it can reuse it before expiry, so do not log it or promise per-request session checks. Signed links use the R2 S3 domain, not custom domains. The dashboard uploads files directly to R2 using getUploadUrl signed PUT links (five minutes, exact size/type, no overwrite; up to 100 MiB). Backend-native port uploads and streaming downloads still use bindings. Configure storage_upload_origins in environment tfvars for manual setup; cicd:setup supplies exact connected origins through R2_UPLOAD_ORIGINS. No automatic file tracking or orphan deletion is generated. R2 transfer has no egress fee, but storage, operations and Worker execution may be billed.\n";
