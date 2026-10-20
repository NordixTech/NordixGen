import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { confirm, intro, isCancel, log, note, outro, password, select, text } from "@clack/prompts";
import { execa } from "execa";
import pc from "picocolors";
import type { DeploymentManifest, DeploymentProfile, Environment } from "./deployment-model.js";
import { configureInfrastructureReview } from "./infrastructure-review.js";
import { infrastructureStage } from "./infrastructure-runner.js";
import { prepareInfrastructure } from "./infrastructure-setup.js";

const environments = ["staging", "production"] as const;
const branchFor = { staging: "develop", production: "main" } as const;
const cfBase = "https://api.cloudflare.com/client/v4";
const neonBase = "https://console.neon.tech/api/v2";
type Json = Record<string, unknown>;
function object(value: unknown): Json {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error(
      "Provider returned an unexpected object. Review resource configuration before retrying.",
    );
  return value as Json;
}
function items(value: unknown): Json[] {
  if (!Array.isArray(value))
    throw Error("Provider returned an unexpected list. Check API permissions.");
  return value.map(object);
}
function field(value: unknown): string {
  if (typeof value !== "string" || !value)
    throw Error("Provider returned a missing or invalid field.");
  return value;
}
const secrets = new Set<string>();
export function redact(value: string): string {
  let result = value.replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "[redacted database connection]");
  for (const [key, secret] of Object.entries(process.env))
    if (/SECRET|TOKEN|PASSWORD|API_KEY|DATABASE_URL/i.test(key) && secret)
      result = result.replaceAll(secret, "[redacted]");
  for (const secret of secrets) if (secret) result = result.replaceAll(secret, "[redacted]");
  return result;
}

/** Never include provider response bodies, URLs with credentials, or subprocess output in errors. */
export async function requestApi(
  base: string,
  path: string,
  token: string,
  method = "GET",
  body?: unknown,
  fetcher: typeof fetch = fetch,
): Promise<Json> {
  let response: Response;
  try {
    response = await fetcher(`${base}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
      redirect: "error",
    });
  } catch {
    throw Error(
      "Provider request failed. Check connectivity and retry; credentials were not printed.",
    );
  }
  if (!response.ok && response.status === 403 && path.includes("/r2/")) {
    let code: unknown;
    try {
      code = ((await response.clone().json()) as { errors?: { code: number }[] }).errors?.[0]?.code;
    } catch {}
    if (code === 10042)
      throw Error(
        "R2 is not enabled in this Cloudflare account. Open Cloudflare Dashboard > R2 Object Storage and complete activation, then rerun setup. No R2 resources were created.",
      );
    throw Error(
      "R2 access was denied. Add Account > Workers R2 Storage > Edit for the selected account, then rerun setup.",
    );
  }
  if (!response.ok)
    throw Error(
      `Provider ${new URL(base).hostname} returned HTTP ${response.status} for ${method} ${path.split("?")[0]}. Check permissions and dashboard before retrying.`,
    );
  const data = (await response.json()) as Json;
  if (data.success === false)
    throw Error(
      "Cloudflare rejected the operation. Check token permissions and resource settings in the dashboard.",
    );
  return data;
}
function answer<T>(value: T | symbol): T {
  if (isCancel(value))
    throw Error("Setup cancelled. Already created resources remain available in the dashboards.");
  return value as T;
}
async function input(message: string, initialValue = "", secret = false): Promise<string> {
  const value = String(
    answer(
      await (secret
        ? password({ message, validate: (v) => (v.trim() ? undefined : "Required") })
        : text({ message, initialValue, validate: (v) => (v.trim() ? undefined : "Required") })),
    ),
  ).trim();
  if (secret) secrets.add(value);
  return value;
}
function visibleNote(message: string, title: string) {
  // Clack dims each note line; reset that style so body text uses the terminal foreground.
  note(
    message
      .split("\n")
      .map((line) => pc.reset(line))
      .join("\n"),
    title,
  );
}
function instructionCard(instructions: string) {
  const [title, ...lines] = instructions.split("\n");
  const body = lines.map((line) =>
    line
      .replace(/^(\d+\.)/, (step) => pc.cyan(pc.bold(step)))
      .replace(/https:\/\/[^\s]+/g, (url) => pc.cyan(pc.underline(url))),
  );
  visibleNote(body.join("\n"), pc.bold(pc.cyan(title)));
}
export const accessInstructions = {
  cloudflare: `1 / Cloudflare access
Use one API token to configure and deploy this project.

1. Open the token page:
   https://dash.cloudflare.com/profile/api-tokens
2. My Profile > API Tokens > Create Token > Create Custom Token.
3. Name: NordixGen. Add these Account permissions:
   • Account Settings — Read
   • Workers Scripts — Edit
   • Workers Builds Configuration — Edit
4. Account Resources: select the account you want to deploy to.
5. Create the token, copy its secret, then paste it below.

Use an API token, not the Global API Key.
You can reuse this token for automatic deployments in the next steps.`,
  neon: `4 / Neon access
The assistant creates the database through the Neon API.

1. Open https://console.neon.tech and sign in.
2. Profile menu > Settings (or Account settings) > API keys.
3. Create a personal API key named NordixGen.
4. Copy its secret now, then paste it into the masked prompt.

A personal key can create projects in your organizations.
A project-scoped key cannot create a new project.
No Neon-to-GitHub integration is needed.
The Neon key is never uploaded to Workers or builds.

Help: https://neon.com/docs/manage/api-keys`,
};
export function githubAccessInstructions(accountId: string, repository: string): string {
  return `2 / Connect GitHub
Repository: ${repository}

1. Open your Cloudflare Workers dashboard:
   https://dash.cloudflare.com/${accountId}/workers-and-pages
2. Select a Worker > Settings > Builds > Connect > GitHub.
   No Workers yet? Create a temporary Hello World Worker first.
3. Authorize Cloudflare Workers and Pages for the repository owner.
4. If using Only select repositories, include:
   ${repository.split("/")[1]}
5. Save, then return to this assistant.

Review installed apps: https://github.com/settings/installations
Browser authorization is required once. The assistant cannot grant it.
Repository connection is checked before creating any Neon project.`;
}
async function credential(name: string, instructions: string): Promise<string> {
  instructionCard(instructions);
  if (process.env[name]) {
    log.warn(`${name} exists in this shell and may be old or revoked.`);
    if (answer(await confirm({ message: `Use ${name} from this shell?`, initialValue: false })))
      return process.env[name] as string;
  }
  return input(`Paste ${name} (masked; kept in memory only)`, "", true);
}
export async function validatedCredential(
  name: string,
  instructions: string,
  base: string,
  path: string,
) {
  for (;;) {
    const token = await credential(name, instructions);
    try {
      const response = await requestApi(base, path, token);
      return { token, response };
    } catch (error) {
      log.error(redact(error instanceof Error ? error.message : "Credential check failed."));
      if (
        !answer(await confirm({ message: "Review the instructions and try another credential?" }))
      )
        throw Error("Access could not be verified. No cloud resources were created.");
    }
  }
}
export function publicOrigin(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw Error("Use an HTTPS origin without credentials, paths, query or fragment.");
  return url.origin;
}
async function run(args: string[], cwd = process.cwd(), env: Record<string, string> = {}) {
  console.log(`Running pnpm ${args.join(" ")}...`);
  try {
    await execa("pnpm", args, { cwd, env, stdout: "pipe", stderr: "pipe" });
  } catch (error) {
    if (error && typeof error === "object" && "stdout" in error)
      console.error(
        redact(`${error.stdout ?? ""}\n${"stderr" in error ? (error.stderr ?? "") : ""}`).slice(
          0,
          6000,
        ),
      );
    throw Error(
      `Command failed: pnpm ${args.join(" ")}. Re-run the command locally to inspect its output; provider secrets were not printed.`,
    );
  }
}
export function checkDeploymentBranch(
  environment: Environment,
  branch = process.env.WORKERS_CI_BRANCH,
) {
  if (branch && branch !== branchFor[environment])
    throw Error(
      `Refusing ${environment} deployment from ${branch}. Expected ${branchFor[environment]}.`,
    );
}
export async function executeStage(
  manifest: DeploymentManifest,
  stage: string,
  name: string,
  environment: Environment,
) {
  if (!environments.includes(environment)) throw Error("Choose staging or production.");
  const app = manifest.applications.find((a) => a.name === name);
  if (!app) throw Error(`Unknown application ${name}.`);
  checkDeploymentBranch(environment);
  const env = { CLOUDFLARE_ENV: environment };
  if (stage === "build") {
    await infrastructureStage(manifest, environment);
    await run(["--dir", app.path, "run", "typecheck"], process.cwd(), env);
    if (app.kind === "backend") {
      await run(["--dir", app.path, "run", "check:boundaries"], process.cwd(), env);
      if (app.database) {
        if (!process.env.DATABASE_URL)
          throw Error("DATABASE_URL is required as a build secret before migrations.");
        await run(["--dir", app.path, "run", "db:migrate"], process.cwd(), env);
      }
    } else
      await run(
        ["--dir", app.path, "exec", "opennextjs-cloudflare", "build", "--env", environment],
        process.cwd(),
        env,
      );
  } else if (stage === "deploy") {
    await run(
      [
        "--dir",
        app.path,
        "exec",
        app.kind === "frontend" ? "opennextjs-cloudflare" : "wrangler",
        "deploy",
        "--env",
        environment,
      ],
      process.cwd(),
      env,
    );
  } else throw Error("Unknown deployment stage.");
}
async function connection(
  project: string,
  branch: string,
  api: (path: string, method?: string, body?: unknown) => Promise<Json>,
) {
  const databases = items(
    (await api(`/projects/${project}/branches/${branch}/databases`)).databases,
  );
  const roles = items((await api(`/projects/${project}/branches/${branch}/roles`)).roles);
  const database =
    databases.find((d) => !["postgres", "template0", "template1"].includes(field(d.name))) ??
    databases[0];
  if (!database) throw Error("No database exists on the selected branch.");
  const role = roles.find((r: Json) => r.name === database.owner_name);
  if (!role) throw Error("Database owner role was not found. Configure DATABASE_URL manually.");
  const result = await api(
    `/projects/${project}/connection_uri?branch_id=${encodeURIComponent(branch)}&database_name=${encodeURIComponent(field(database.name))}&role_name=${encodeURIComponent(field(role.name))}&pooled=false`,
  );
  if (typeof result.uri !== "string" || !result.uri.startsWith("postgres"))
    throw Error("Neon did not return a PostgreSQL connection.");
  return result.uri as string;
}
export async function ensureNeonBranches(
  project: string,
  api: (path: string, method?: string, body?: unknown) => Promise<Json>,
) {
  const branches = (await api(`/projects/${project}/branches`)).branches as Json[];
  const main = branches.find((b) => b.name === "main");
  if (!main)
    throw Error(
      `Neon project ${project} needs a root branch named main. Rename the intended production branch in Neon, then retry.`,
    );
  if (main.parent_id) throw Error("Neon main must be a root branch.");
  let staging = branches.find((b) => b.name === "staging");
  if (staging && staging.parent_id !== main.id)
    throw Error("Existing staging does not descend directly from main; review it manually.");
  if (!staging)
    staging = object(
      (
        await api(`/projects/${project}/branches`, "POST", {
          branch: { name: "staging", parent_id: main.id },
          endpoints: [
            {
              type: "read_write",
              autoscaling_limit_min_cu: 0.25,
              autoscaling_limit_max_cu: 1,
              suspend_timeout_seconds: 0,
            },
          ],
        })
      ).branch,
    );
  if (!staging?.id) throw Error("Neon did not return a staging branch ID.");
  return { production: main.id as string, staging: staging.id as string };
}
export async function connectRepository(profile: DeploymentProfile, cfToken: string) {
  try {
    const repo = JSON.parse(
      (await execa("gh", ["api", `repos/${profile.repository}`])).stdout,
    ) as Json;
    return object(
      (
        await requestApi(
          cfBase,
          `/accounts/${profile.accountId}/builds/repos/connections`,
          cfToken,
          "PUT",
          {
            provider_type: "github",
            provider_account_id: String(object(repo.owner).id),
            provider_account_name: field(object(repo.owner).login),
            repo_id: String(repo.id),
            repo_name: field(repo.name),
          },
        )
      ).result,
    );
  } catch {
    throw Error(
      `Cloudflare could not connect to the GitHub repository.\n${githubAccessInstructions(profile.accountId, profile.repository)}`,
    );
  }
}
export async function registerDeploymentToken(accountId: string, token: string, name: string) {
  secrets.add(token);
  const verified = object((await requestApi(cfBase, "/user/tokens/verify", token)).result);
  if (verified.status !== "active")
    throw Error("The deployment token is not active. Create a valid user API token and retry.");
  const tokenId = field(verified.id);
  const path = `/accounts/${accountId}/builds/tokens`;
  const existing = items((await requestApi(cfBase, path, token)).result).find(
    (entry) => entry.cloudflare_token_id === tokenId,
  );
  if (existing) return field(existing.build_token_uuid);
  const registered = object(
    (
      await requestApi(cfBase, path, token, "POST", {
        build_token_name: name,
        build_token_secret: token,
        cloudflare_token_id: tokenId,
      })
    ).result,
  );
  return field(registered.build_token_uuid);
}
export async function configure(
  manifest: DeploymentManifest,
  profile: DeploymentProfile,
  cfToken: string,
  neonToken: string,
  secretInput: (label: string) => Promise<string> = (label) => input(label, "", true),
) {
  validateTopology(manifest, profile);
  const cf = async (path: string, method = "GET", body?: unknown) =>
    (await requestApi(cfBase, `/accounts/${profile.accountId}${path}`, cfToken, method, body))
      .result;
  const neon = (path: string, method = "GET", body?: unknown) =>
    requestApi(neonBase, path, neonToken, method, body);
  const repoConnection = await connectRepository(profile, cfToken);
  const infrastructure = await prepareInfrastructure(
    manifest,
    profile,
    cfToken,
    (path, method, body) => requestApi(cfBase, path, cfToken, method ?? "GET", body),
    (label) => input(label, "", true),
    (value) => secrets.add(value),
  );
  const dbConnections: Record<string, Record<Environment, string>> = {};
  for (const app of manifest.applications.filter((a) => a.database)) {
    const project = profile.neonProjects[app.name];
    const branches = await ensureNeonBranches(project, neon);
    dbConnections[app.name] = {
      production: await connection(project, branches.production, neon),
      staging: await connection(project, branches.staging, neon),
    };
    if (dbConnections[app.name].production === dbConnections[app.name].staging)
      throw Error("Staging and production database connections must differ.");
  }
  for (const app of manifest.applications)
    for (const environment of environments) {
      console.log(`Configuring ${app.name}: ${environment} (${branchFor[environment]})`);
      const worker = `${app.worker}-${environment}`;
      const values: Record<string, string> = {};
      if (app.database) values.DATABASE_URL = dbConnections[app.name][environment];
      if (app.kind === "backend") {
        values[app.identity ? "AUTH_TRUSTED_ORIGINS" : "CORS_ALLOWED_ORIGINS"] = Object.values(
          profile.urls[environment],
        ).join(",");
        if (app.identity) {
          values.BETTER_AUTH_URL = profile.urls[environment][app.name];
          values.BETTER_AUTH_SECRET = await secretInput(
            `${app.name}/${environment}: existing BETTER_AUTH_SECRET (reuse on rerun), or type generate for a new secret`,
          );
          if (values.BETTER_AUTH_SECRET === "generate")
            values.BETTER_AUTH_SECRET = randomBytes(32).toString("hex");
          if (values.BETTER_AUTH_SECRET.length < 32)
            throw Error("BETTER_AUTH_SECRET needs at least 32 characters.");
        }
        for (const key of app.runtimeKeys.filter((k) => !(k in values)))
          values[key] = await input(
            `${app.name}/${environment}: ${key}`,
            "",
            /SECRET|KEY|TOKEN|PASSWORD/.test(key),
          );
        if (app.emailDelivery) {
          const provider = answer(
            await select({
              message: `${app.name}/${environment}: authentication email delivery`,
              options: [
                { value: "resend", label: "Resend API" },
                { value: "smtp", label: "SMTP (Google Workspace, SES, Resend SMTP)" },
              ],
            }),
          );
          values.AUTH_EMAIL_FROM = await input(`${app.name}/${environment}: AUTH_EMAIL_FROM`);
          if (provider === "resend")
            values.RESEND_API_KEY = await input(
              `${app.name}/${environment}: RESEND_API_KEY`,
              "",
              true,
            );
          else {
            values.SMTP_HOST = await input(`${app.name}/${environment}: SMTP_HOST`);
            values.SMTP_PORT = await input(
              `${app.name}/${environment}: SMTP_PORT (465 or 587)`,
              "587",
            );
            values.SMTP_SECURE = values.SMTP_PORT === "465" ? "true" : "false";
            values.SMTP_USER = await input(`${app.name}/${environment}: SMTP_USER`);
            values.SMTP_PASSWORD = await input(
              `${app.name}/${environment}: SMTP_PASSWORD`,
              "",
              true,
            );
          }
        }
      }
      // Bootstrap a new Worker with a 503, never serve application code before secrets/migrations.
      const scripts = (await cf("/workers/scripts")) as Json[];
      let script = scripts.find((s) => s.id === worker);
      if (!script) {
        const form = new FormData();
        form.append(
          "metadata",
          JSON.stringify({ main_module: "bootstrap.mjs", compatibility_date: "2026-10-01" }),
        );
        form.append(
          "bootstrap.mjs",
          new Blob(
            ['export default {fetch(){return new Response("Setup in progress",{status:503})}}'],
            { type: "application/javascript+module" },
          ),
          "bootstrap.mjs",
        );
        const response = await fetch(
          `${cfBase}/accounts/${profile.accountId}/workers/scripts/${worker}`,
          {
            method: "PUT",
            headers: { Authorization: `Bearer ${cfToken}` },
            body: form,
            signal: AbortSignal.timeout(60_000),
            redirect: "error",
          },
        );
        if (!response.ok) throw Error(`Worker bootstrap failed with HTTP ${response.status}.`);
        script = object(object(await response.json()).result);
      }
      for (const [name, value] of Object.entries(values))
        await cf(`/workers/scripts/${worker}/secrets`, "PUT", {
          name,
          text: value,
          type: "secret_text",
        });
      if (!script?.tag) {
        script = ((await cf("/workers/scripts")) as Json[]).find((s) => s.id === worker);
      }
      if (!script?.tag)
        throw Error(
          "Cloudflare did not return the Worker tag; retry after reviewing the Worker in the dashboard.",
        );
      const existing = (await cf(`/builds/workers/${script.tag}/triggers`)) as Json[];
      const triggerName = `NordixGen ${app.name} ${environment}`;
      const owned = existing.find((t) => t.trigger_name === triggerName);
      const config = {
        external_script_id: script.tag,
        repo_connection_uuid: repoConnection.repo_connection_uuid,
        build_token_uuid: profile.buildTokenId,
        trigger_name: triggerName,
        build_command: `pnpm cicd:build ${app.name} ${environment}`,
        deploy_command: `pnpm cicd:deploy ${app.name} ${environment}`,
        root_directory: "/",
        branch_includes: [branchFor[environment]],
        branch_excludes: [],
        path_includes: ["*", "**/*"],
        path_excludes: [],
      };
      const trigger = object(
        owned
          ? await cf(`/builds/triggers/${owned.trigger_uuid}`, "PATCH", config)
          : await cf("/builds/triggers", "POST", config),
      );
      await cf(
        `/builds/triggers/${trigger.trigger_uuid}/environment_variables`,
        "PATCH",
        Object.fromEntries(
          Object.entries({
            ...Object.fromEntries(
              Object.entries(values).filter(
                ([key]) => !key.startsWith("R2_") && !key.includes("SECRET"),
              ),
            ),
            ...(infrastructure ? infrastructure.build : {}),
            CLOUDFLARE_ENV: environment,
            NODE_VERSION: "24",
            PNPM_VERSION: "10.5.2",
          }).map(([key, value]) => [
            key,
            {
              value,
              is_secret:
                !key.startsWith("NEXT_PUBLIC_") &&
                !["CLOUDFLARE_ENV", "NODE_VERSION", "PNPM_VERSION"].includes(key),
            },
          ]),
        ),
      );
      console.log(
        `Ready for pushes to ${branchFor[environment]}. Dashboard: https://dash.cloudflare.com/${profile.accountId}/workers/services/view/${worker}/production`,
      );
    }
  if (infrastructure)
    await configureInfrastructureReview(
      manifest,
      profile,
      infrastructure,
      cfToken,
      cf,
      String(repoConnection.repo_connection_uuid),
    );
}
export function validateTopology(manifest: DeploymentManifest, profile: DeploymentProfile) {
  for (const environment of environments)
    for (const app of manifest.applications) {
      if (app.kind === "frontend" || app.identity)
        publicOrigin(profile.urls[environment][app.name]);
    }
  const projects = manifest.applications
    .filter((a) => a.database)
    .map((a) => profile.neonProjects[a.name]);
  if (projects.some((p) => !p) || new Set(projects).size !== projects.length)
    throw Error("Choose a distinct Neon project for every persisted backend.");
}
export async function provisionNeonProjects(
  manifest: DeploymentManifest,
  profile: DeploymentProfile,
  token: string,
  save: () => Promise<void>,
) {
  for (const app of manifest.applications.filter((a) => a.database)) {
    const id = profile.neonProjects[app.name];
    if (!id.startsWith("new:")) continue;
    const [, org_id, region_id] = id.split(":");
    if (!org_id || !region_id) throw Error("Use new:<organization-id>:<region-id>.");
    const data = await requestApi(neonBase, "/projects", token, "POST", {
      project: {
        name: `${manifest.project}-${app.name}`,
        org_id,
        region_id,
        branch: { name: "main" },
      },
    });
    const created = object(data.project);
    profile.neonProjects[app.name] = field(created.id);
    log.success(
      `Neon project created: ${field(created.name ?? `${manifest.project}-${app.name}`)} (ID: ${field(created.id)})`,
    );
    await save();
  }
}
export async function chooseNeonProject(
  name: string,
  token: string,
  previous?: string,
): Promise<string> {
  if (previous && !previous.startsWith("new:")) {
    let project: Json | undefined;
    try {
      project = object(
        (await requestApi(neonBase, `/projects/${encodeURIComponent(previous)}`, token)).project,
      );
    } catch {
      log.warn(
        "The saved Neon project is unavailable or inaccessible. Select a destination again.",
      );
    }
    if (
      project &&
      answer(
        await confirm({
          message: `Reuse ${field(project.name)} for ${name}? (ID: ${field(project.id)})`,
          initialValue: true,
        }),
      )
    )
      return field(project.id);
  }
  let mode = answer(
    await select({
      message: `Database for ${name}`,
      options: [
        {
          value: "new",
          label: "Create a new Neon project",
          hint: "recommended for a new deployment",
        },
        { value: "existing", label: "Select an existing Neon project" },
      ],
    }),
  );
  const orgs = items((await requestApi(neonBase, "/users/me/organizations", token)).organizations);
  if (!orgs.length)
    throw Error(
      "No Neon organization is available. Use a personal API key with organization access.",
    );
  const org = String(
    answer(
      await select({
        message: "Neon organization",
        options: orgs.map((o) => ({ value: field(o.id), label: field(o.name) })),
      }),
    ),
  );
  if (mode === "existing") {
    const projects = items(
      (await requestApi(neonBase, `/projects?org_id=${encodeURIComponent(org)}`, token)).projects,
    );
    if (projects.length) {
      const id = String(
        answer(
          await select({
            message: "Select the database project (name and internal ID)",
            options: projects.map((p) => ({
              value: field(p.id),
              label: field(p.name),
              hint: `ID: ${field(p.id)}`,
            })),
          }),
        ),
      );
      const project = object(
        (await requestApi(neonBase, `/projects/${encodeURIComponent(id)}`, token)).project,
      );
      if (field(project.id) !== id)
        throw Error("Neon returned an unexpected project. Retry setup.");
      return id;
    }
    log.info(
      "This organization has no projects. Choose a region to prepare a new project instead.",
    );
    mode = "new";
  }
  const regions = (await requestApi(neonBase, "/regions", token)).regions as Json[];
  const region = String(
    answer(
      await select({
        message: "Database region (choose near your users)",
        options: regions.map((r) => ({
          value: field(r.region_id ?? r.id),
          label: field(r.name ?? r.region_id ?? r.id),
        })),
      }),
    ),
  );
  return `new:${org}:${region}`;
}
export function cloudflareSetupInstructions(infrastructure = false) {
  return (
    accessInstructions.cloudflare +
    (infrastructure
      ? "\n\nThis project declares R2 infrastructure. Enable R2 Object Storage in the Cloudflare dashboard. Also add Account > Workers R2 Storage > Edit and User > API Tokens > Edit/Read, or Account > Account API Tokens > Edit/Read for account-owned download credentials. The assistant reuses this setup token for infrastructure and PR plans; it creates only bucket-scoped backend download-signing credentials. Administrative keys never enter frontend or backend application code. Public bucket custom domains also require Zone > Zone > Read and the relevant domain permissions. GitHub access also needs repository webhook administration for PR plan events."
      : "")
  );
}
export async function setupDeployment(manifest: DeploymentManifest, profileName: string) {
  if (typeof profileName !== "string" || !/^[a-z][a-z0-9-]*$/.test(profileName))
    throw Error("Profile names use lowercase letters, numbers and hyphens.");
  intro(pc.bgCyan(pc.black(" NordixGen · CI/CD setup ")));
  log.info(
    "develop → staging  •  main → production\nConfigure access, review destinations, then apply.",
  );
  const profilePath = resolve(".nordixgen", `cicd.${profileName}.json`);
  let previous: Partial<DeploymentProfile> = {};
  try {
    previous = JSON.parse(await readFile(profilePath, "utf8"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw Error("Saved profile is invalid.");
  }
  const { token: cfToken, response: accountResponse } = await validatedCredential(
    "CLOUDFLARE_API_TOKEN",
    cloudflareSetupInstructions(Boolean(manifest.infrastructure)),
    cfBase,
    "/accounts",
  );
  const accounts = items(accountResponse.result);
  if (!accounts.length)
    throw Error("No Cloudflare accounts are visible. Check Account Settings Read permission.");
  const accountId = String(
    answer(
      await select({
        message: "Cloudflare account",
        initialValue: previous.accountId,
        options: accounts.map((a) => ({ value: field(a.id), label: field(a.name) })),
      }),
    ),
  );
  if (!/^[a-f0-9]{32}$/.test(accountId)) throw Error("Invalid Cloudflare account ID.");
  let detectedRepository = "";
  try {
    const remote = (await execa("git", ["remote", "get-url", "origin"])).stdout;
    detectedRepository = /github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/.exec(remote)?.[1] ?? "";
  } catch {
    /* A remote remains optional until CI/CD is connected. */
  }
  const repository = await input(
    "GitHub repository (owner/name), already containing main and develop",
    previous.repository ?? detectedRepository,
  );
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw Error("Expected owner/repository.");
  for (const branch of Object.values(branchFor))
    await execa("gh", ["api", `repos/${repository}/branches/${branch}`], {
      stdout: "pipe",
      stderr: "pipe",
    }).catch(() => {
      throw Error(
        `GitHub branch ${branch} is unavailable. Install GitHub CLI from https://cli.github.com, run gh auth login and choose browser authentication. Publish main and develop with git push --atomic --set-upstream origin main develop, then retry.`,
      );
    });
  instructionCard(githubAccessInstructions(accountId, repository));
  if (
    !answer(
      await confirm({
        message: "Have you authorized Cloudflare for this GitHub repository?",
        initialValue: false,
      }),
    )
  )
    throw Error(
      "Complete the browser authorization above, then rerun setup. No resources were created.",
    );
  instructionCard(
    "3 / Automatic deployments\nYour API token can deploy the application after each push.\n\nRecommended: reuse the token you already entered.\nThe assistant registers it with Cloudflare Workers Builds.\nCloudflare retains this credential to deploy when your computer is off.\nIt is never saved in the repository or the public profile.\n\nYou do not need to create another token.",
  );
  const deploymentAccess = answer(
    await select({
      message: "How should Cloudflare authenticate deployments?",
      options: [
        {
          value: "reuse",
          label: "Use the API token I already entered",
          hint: "recommended · no additional token",
        },
        { value: "existing", label: "Select a registered build token", hint: "advanced" },
      ],
    }),
  );
  let buildTokenId = "";
  if (deploymentAccess === "existing") {
    const tokenData = items(
      (await requestApi(cfBase, `/accounts/${accountId}/builds/tokens`, cfToken)).result,
    );
    if (!tokenData.length)
      throw Error(
        "No registered build tokens were found. Rerun setup and choose Use the API token I already entered.",
      );
    buildTokenId = String(
      answer(
        await select({
          message: "Registered deployment token",
          options: tokenData.map((t) => ({
            value: field(t.build_token_uuid),
            label: field(t.build_token_name),
          })),
        }),
      ),
    );
  }
  const profile: DeploymentProfile = {
    accountId,
    repository,
    buildTokenId,
    neonProjects: previous.neonProjects ?? {},
    urls:
      previous.accountId === accountId && previous.urls
        ? previous.urls
        : { staging: {}, production: {} },
  };
  let subdomain: string;
  try {
    subdomain = field(
      object((await requestApi(cfBase, `/accounts/${accountId}/workers/subdomain`, cfToken)).result)
        .subdomain,
    );
  } catch {
    throw Error(
      `A workers.dev subdomain could not be read. Open https://dash.cloudflare.com/${accountId}/workers-and-pages, complete the first-time workers.dev subdomain registration, and check the setup token permissions. Then rerun setup.`,
    );
  }
  for (const environment of environments)
    for (const name of Object.keys(
      manifest.publicFrontends ??
        Object.fromEntries(
          manifest.applications.filter((a) => a.kind === "frontend").map((a) => [a.name, {}]),
        ),
    )) {
      const app =
        manifest.publicFrontends?.[name] ?? manifest.applications.find((a) => a.name === name);
      const generatedOrigin = app
        ? `https://${app.worker}-${environment}.${subdomain}.workers.dev`
        : "";
      let suggestion = profile.urls[environment][name] ?? generatedOrigin;
      if (
        app &&
        suggestion &&
        new URL(suggestion).hostname.endsWith(".workers.dev") &&
        suggestion !== generatedOrigin
      ) {
        log.warn(
          "The saved workers.dev URL does not match this generated Worker. The suggested URL has been corrected.",
        );
        suggestion = generatedOrigin;
      }
      profile.urls[environment][name] = publicOrigin(
        await input(`${name}/${environment}: public HTTPS origin`, suggestion),
      );
    }
  for (const environment of environments)
    for (const app of manifest.applications.filter((a) => a.kind === "backend")) {
      const consumers = Object.entries(manifest.publicFrontends ?? {}).filter(([, frontend]) =>
        frontend.connections.includes(app.name),
      );
      profile.urls[environment][app.name] = consumers.length
        ? profile.urls[environment][consumers[0][0]]
        : app.identity
          ? publicOrigin(await input(`${app.name}/${environment}: public frontend identity origin`))
          : "https://internal.invalid";
    }
  const neonToken = manifest.applications.some((a) => a.database)
    ? (
        await validatedCredential(
          "NEON_API_KEY",
          accessInstructions.neon,
          neonBase,
          "/users/me/organizations",
        )
      ).token
    : "";
  for (const app of manifest.applications.filter((a) => a.database))
    profile.neonProjects[app.name] = await chooseNeonProject(
      app.name,
      neonToken,
      profile.neonProjects[app.name],
    );
  validateTopology(manifest, profile);
  visibleNote(
    [
      `Cloudflare account: ${accountId}`,
      `GitHub repository:  ${repository}`,
      `Applications:       ${manifest.applications.map((a) => a.name).join(", ")}`,
      "",
      "develop → staging · main → production",
      ...Object.entries(profile.neonProjects).map(([app, id]) =>
        id.startsWith("new:")
          ? `Neon ${app}: create project ${manifest.project}-${app}`
          : `Neon ${app}: existing project ID ${id}`,
      ),
      deploymentAccess === "reuse"
        ? "Cloudflare will retain your API token for automatic deployments."
        : "Deployments use the registered token you selected.",
      "Workers, build triggers and secrets will be created or updated.",
      "Existing databases are never reset or deleted.",
    ].join("\n"),
    pc.bold(pc.cyan("Review configuration")),
  );
  if (!answer(await confirm({ message: "Apply this configuration?" }))) return;
  await mkdir(resolve(".nordixgen"), { recursive: true });
  const save = () =>
    writeFile(profilePath, `${JSON.stringify(profile, null, 2)}\n`, { mode: 0o600 });
  await connectRepository(profile, cfToken);
  if (deploymentAccess === "reuse") {
    profile.buildTokenId = await registerDeploymentToken(
      accountId,
      cfToken,
      `${manifest.project} deployments`,
    );
    log.success("Your API token is registered for automatic deployments.");
  }
  await save();
  await provisionNeonProjects(manifest, profile, neonToken, save);
  await configure(manifest, profile, cfToken, neonToken);
  await save();
  log.info(
    "Inspect build logs in Cloudflare > Worker > Builds.\nSee docs/DEPLOYMENT.md for routes and recovery.",
  );
  outro(pc.green("Setup complete. Push develop to test staging, then main for production."));
}
async function main() {
  if (process.argv.includes("--help")) {
    console.log(
      "Usage: pnpm cicd:setup [--profile client] | pnpm cicd:build <app> <staging|production> | pnpm cicd:deploy <app> <staging|production>\nRun from the generated repository root. Setup uses masked token prompts or CLOUDFLARE_API_TOKEN and NEON_API_KEY. It creates/updates cloud resources only after displaying destinations and asking to apply. See docs/DEPLOYMENT.md for manual setup.",
    );
    return;
  }
  const manifest = JSON.parse(
    await readFile("nordixgen.deployment.json", "utf8"),
  ) as DeploymentManifest;
  if (manifest.version !== 1 || !Array.isArray(manifest.applications))
    throw Error("Unsupported deployment manifest.");
  const args = process.argv.slice(2).filter((a) => a !== "--");
  if (args[0] === "build" || args[0] === "deploy")
    await executeStage(manifest, args[0], args[1], args[2] as Environment);
  else if (!args.length || args[0] === "setup") {
    const index = args.indexOf("--profile");
    await setupDeployment(manifest, index < 0 ? "default" : args[index + 1]);
  } else
    throw Error(
      "Usage: pnpm cicd:setup [--profile client] | pnpm cicd:build <app> <staging|production> | pnpm cicd:deploy <app> <staging|production>",
    );
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch((error) => {
    console.error(
      redact(error instanceof Error ? error.message : "Unknown failure").slice(0, 2000),
    );
    console.error(
      "CI/CD operation failed. Check the selected accounts, token permissions, required values and docs/DEPLOYMENT.md. Resources already created remain available; rerun with the same profile to resume. No secrets were printed.",
    );
    process.exitCode = 1;
  });
