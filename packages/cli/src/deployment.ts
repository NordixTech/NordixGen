import { readFile } from "node:fs/promises";
import { type ResolvedProject, cloudflareWorkerName } from "@nordixgen/core";
import type { DeploymentManifest } from "./deployment-model.js";

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
    applications: [
      ...Object.values(project.backends)
        .filter((a) => a.repository.name === repository.name)
        .map((a) => ({
          name: a.name,
          path: a.path,
          worker: cloudflareWorkerName(project.project.name, a.name),
          kind: "backend" as const,
          database: Boolean(a.database),
          identity: Boolean(a.identity),
          connections: [],
          runtimeKeys: [
            ...(a.identity?.identityProviders.flatMap((p) => [
              `${p.toUpperCase()}_CLIENT_ID`,
              `${p.toUpperCase()}_CLIENT_SECRET`,
            ]) ?? []),
            ...(a.identity?.features.some(
              (f) => f === "email-verification" || f === "password-recovery",
            )
              ? ["RESEND_API_KEY", "AUTH_EMAIL_FROM"]
              : []),
          ],
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
  };
}
export const deploymentReadme = [
  "## CI/CD configuration with database",
  "",
  "Git is initialized on `main` with the generated project committed; `develop` starts at the same commit. Remote creation is optional. Before configuring CI/CD, publish both branches to GitHub.",
  "",
  "### Option 1 — Guided CLI assistant",
  "",
  "Run `pnpm cicd:setup` from this repository root. It asks for Cloudflare/GitHub/Neon destinations, prepares Neon staging, uploads runtime/build secrets, and configures native Cloudflare push triggers. Read the prerequisites in [the deployment guide](docs/DEPLOYMENT.md) first. Use `pnpm cicd:setup --profile client-name` to configure another account without changing the application code.",
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

One persistent Worker per application/environment. Feature branches do not deploy through these triggers. Staging is not an ephemeral Preview. A Git merge applies committed migrations; it never copies or merges staging database data into production. Each persisted backend owns a dedicated Neon project/database resource. Backend-only, frontend-only repositories and monorepos use the same root commands below. Configure a split backend repository first, then supply its URLs to the frontend repository.

## Prerequisites for both options

- Node.js 24, pnpm 10.5.2, dependencies installed, GitHub CLI authenticated with access to the remote repository.
- Publish both official branches: \`git remote add origin <your-repository-url>\` (if needed), then \`git push --atomic --set-upstream origin main develop\`. For a new remote, set its default branch to main in GitHub.
- Authorize the Cloudflare Workers and Pages GitHub App for the repository in Cloudflare Settings > Builds > Connect. For a newly created private repository, open https://github.com/settings/installations, configure Cloudflare Workers and Pages and add the repository if access is restricted to selected repositories. This browser authorization is required once; an API token cannot grant GitHub App access.
- Create/select a Workers Builds deployment token under Settings > Builds > API token. The assistant lists these tokens. This managed build token is distinct from the API token used to configure builds.
- A Cloudflare user API token scoped to the target account: Workers Scripts Edit, Workers Builds Configuration Edit, Account Settings Read; Workers Routes Edit and Zone Read when managing custom routes. Add permissions required by additional bindings you introduce. The Builds API currently requires a user token, not an account-owned token.
- For assistant-managed Neon creation/branch setup, a Neon API key with access to the intended organization/project. A project-scoped key can manage existing branches but cannot create a new project. No Neon administrative API key is stored in builds or Workers.

## Option 1: guided CLI

Run from this repository root:

\`\`\`sh
pnpm cicd:setup
# Separate public destination profile for another account:
pnpm cicd:setup --profile other-client
\`\`\`

Tokens can be provided through \`CLOUDFLARE_API_TOKEN\` and \`NEON_API_KEY\` in the local shell, or entered in masked prompts. They are never stored in a profile or manifest. Do not paste credentials into command arguments or Git. Profiles in ignored \`.nordixgen/\` contain destination IDs and URLs only. Keep any environment configuration files outside Git too.

The assistant lists Cloudflare accounts, detects the GitHub remote, lists managed build tokens and proposes workers.dev origins. For each persisted backend, choose an existing Neon project or create a new one by selecting its organization and region. The project is created with root branch main and a persistent staging child with plan-default scale-to-zero enabled (normally 300 seconds). Existing main must already be a root; an existing staging must be its direct child. Existing databases are never reset or deleted. The assistant obtains each connection, configures separate runtime/build secrets and upserts named push triggers. It bootstraps new Workers with a 503 response until a real build succeeds. Public profiles are saved before subsequent steps so a failed setup can resume.

For an existing deployment, reuse its BETTER_AUTH_SECRET when asked. Entering \`generate\` deliberately rotates that environment's secret and may invalidate sessions. Keep production and staging secrets different. OAuth credentials and email configuration are prompted only when those features were generated.

After setup, push a new commit to develop and inspect its native Cloudflare build. Then merge into main and check production. Setup configures triggers; it does not claim that an application has passed a live deployment.

## Option 2: manual setup

1. Create a Neon project for each persisted backend. Name its root branch main (the Console may initially call it production). Create staging once as a child of main, with its own read-write compute. Copy a direct PostgreSQL connection for each branch/database/owner role. Configure compute scale-to-zero for staging. Suspended compute does not consume CU-hours, but storage/history and any excess-branch charges still apply.
2. Review committed SQL in each backend's \`drizzle/\`. The generator creates migrations; do not run schema generation or seeds during deployment. Optional IAM bootstrap is already part of db:migrate and does not overwrite edited grants.
3. Configure the environment matrix below. Runtime secrets go to the matching Worker Settings > Variables and Secrets. Build secrets go to Settings > Builds > Variables and Secrets. DATABASE_URL is needed in both places. Frontend NEXT_PUBLIC values are required at build time and may be required on the server at runtime. Never set NODE_ENV=production before installing dependencies: typechecking and migrations need devDependencies.
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
| BETTER_AUTH_URL | Authenticated backend runtime | Public identity API origin |
| AUTH_TRUSTED_ORIGINS | Authenticated backend runtime | Exact allowed frontend origins, comma separated |
| CORS_ALLOWED_ORIGINS | Backend without auth, runtime | Exact allowed frontend origins, comma separated |
| NEXT_PUBLIC_<BACKEND>_BASE_URL | Frontend build + runtime | Public origin of each connected backend, hyphens replaced with underscores |
| NEXT_PUBLIC_AUTH_BASE_URL | Authenticated frontend build + runtime | Selected identity backend's public origin |
| AUTH_INTERNAL_BASE_URL | Optional authenticated frontend runtime | Direct identity backend origin for server calls; never a browser credential |
| Provider CLIENT_ID / CLIENT_SECRET, RESEND_API_KEY, AUTH_EMAIL_FROM | Backend runtime, when generated | Existing Better Auth OAuth and email features |

## Authenticated browser topology

Keep frontend and its identity API on the SAME HTTPS origin so the existing host-only Better Auth session cookie is also present on frontend server requests. For example, frontend https://app.example.com and the identity backend on https://app.example.com/api/* via Cloudflare Worker Routes. A route for /api/* takes priority over the frontend's route; configure your proxied zone/DNS and worker routing in Cloudflare, then put the same origin in the frontend and backend settings. Do not attach conflicting custom domains to both Workers. For multiple backends use distinct API route prefixes/domains that match your authored endpoint topology; authenticated cross-origin business APIs need an explicitly designed cookie/proxy topology.

Separate *.workers.dev hostnames are suitable for a public demo, but do NOT provide cookie sharing for protected SSR pages. CORS alone does not solve this. The assistant rejects separate origins for a frontend and its selected identity API. Routes/domains remain an explicit dashboard step in both setup options. Authentication remains self-hosted Better Auth; do not enable Neon Managed Auth.

## Change accounts and retry

Use a new profile, supply credentials for the new Cloudflare account, authorize GitHub there, and recreate the same Worker/build configuration. Supply the existing Neon project to retain data or a transferred/replaced project explicitly. Changing a token does not move Workers, domains or database data. Deploy and verify staging first, then production; move DNS/routes after verification and disable old build triggers so subsequent pushes do not deploy to both accounts unintentionally. Old resources are not automatically deleted. Profiles do not migrate data or custom domains. On failure review resources in the dashboards and rerun with the saved profile; named triggers and existing branches are reused. Re-running writes runtime/build values again; preserve auth secrets. A project transferred between Neon organizations may require a new project-scoped API key.

## Verification and costs

Check /health for every backend, render each frontend, run a generated business list/create operation to verify migrations, and test sign-up/login, protected server navigation and logout if auth is enabled. Verify separate data in staging and production. Confirm main pushes never change staging and develop pushes never change production. Keep credentials out of screenshots and build logs. Record the tested commit and provider build IDs.

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
