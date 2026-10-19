import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { confirm, isCancel, password, select, text } from "@clack/prompts";
import { execa } from "execa";
import type { DeploymentManifest, DeploymentProfile, Environment } from "./deployment-model.js";

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
async function credential(name: string): Promise<string> {
  return process.env[name] || input(name, "", true);
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
export async function configure(
  manifest: DeploymentManifest,
  profile: DeploymentProfile,
  cfToken: string,
  neonToken: string,
) {
  validateTopology(manifest, profile);
  const cf = async (path: string, method = "GET", body?: unknown) =>
    (await requestApi(cfBase, `/accounts/${profile.accountId}${path}`, cfToken, method, body))
      .result;
  const neon = (path: string, method = "GET", body?: unknown) =>
    requestApi(neonBase, path, neonToken, method, body);
  const repo = JSON.parse(
    (await execa("gh", ["api", `repos/${profile.repository}`])).stdout,
  ) as Json;
  const repoConnection = object(
    await cf("/builds/repos/connections", "PUT", {
      provider_type: "github",
      provider_account_id: String(object(repo.owner).id),
      provider_account_name: field(object(repo.owner).login),
      repo_id: String(repo.id),
      repo_name: repo.name,
    }),
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
          values.BETTER_AUTH_SECRET = await input(
            `${app.name}/${environment}: existing BETTER_AUTH_SECRET (reuse on rerun), or type generate for a new secret`,
            "",
            true,
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
            /SECRET|KEY/.test(key),
          );
      } else {
        for (const backend of app.connections) {
          const key = `NEXT_PUBLIC_${backend.toUpperCase().replaceAll("-", "_")}_BASE_URL`;
          values[key] = profile.urls[environment][backend];
        }
        if (app.identityBackend) {
          values.NEXT_PUBLIC_AUTH_BASE_URL = profile.urls[environment][app.identityBackend];
          if (values.NEXT_PUBLIC_AUTH_BASE_URL !== profile.urls[environment][app.name])
            throw Error(
              "Authenticated frontend and identity API must share an origin. Configure Cloudflare /api/* routes first; see docs/DEPLOYMENT.md.",
            );
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
            ...values,
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
}
export function validateTopology(manifest: DeploymentManifest, profile: DeploymentProfile) {
  for (const environment of environments)
    for (const app of manifest.applications) {
      publicOrigin(profile.urls[environment][app.name]);
      for (const backend of app.connections) publicOrigin(profile.urls[environment][backend]);
      if (
        app.identityBackend &&
        profile.urls[environment][app.identityBackend] !== profile.urls[environment][app.name]
      )
        throw Error(
          "Authenticated frontend and identity API must share an origin. Configure Cloudflare /api/* routes first; see docs/DEPLOYMENT.md.",
        );
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
    profile.neonProjects[app.name] = field(object(data.project).id);
    await save();
  }
}
async function chooseNeonProject(name: string, token: string, previous?: string): Promise<string> {
  if (previous && !previous.startsWith("new:")) {
    if (
      answer(
        await confirm({
          message: `Reuse Neon project ${previous} for ${name}?`,
          initialValue: true,
        }),
      )
    )
      return previous;
  }
  const mode = answer(
    await select({
      message: `Database for ${name}`,
      options: [
        { value: "existing", label: "Use an existing Neon project" },
        { value: "new", label: "Create a new Neon project" },
      ],
    }),
  );
  if (mode === "existing") return input(`${name}: Neon project ID`, previous);
  const orgs = (await requestApi(neonBase, "/users/me/organizations", token))
    .organizations as Json[];
  if (!orgs.length)
    throw Error(
      "No Neon organization is available; use an existing project or a key with organization access.",
    );
  const org = String(
    answer(
      await select({
        message: "Neon organization",
        options: orgs.map((o) => ({ value: field(o.id), label: field(o.name) })),
      }),
    ),
  );
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
export async function setupDeployment(manifest: DeploymentManifest, profileName: string) {
  if (typeof profileName !== "string" || !/^[a-z][a-z0-9-]*$/.test(profileName))
    throw Error("Profile names use lowercase letters, numbers and hyphens.");
  const profilePath = resolve(".nordixgen", `cicd.${profileName}.json`);
  let previous: Partial<DeploymentProfile> = {};
  try {
    previous = JSON.parse(await readFile(profilePath, "utf8"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw Error("Saved profile is invalid.");
  }
  const cfToken = await credential("CLOUDFLARE_API_TOKEN");
  const accounts = (await requestApi(cfBase, "/accounts", cfToken)).result as Json[];
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
        `GitHub branch ${branch} is unavailable. Publish both branches and authenticate gh first.`,
      );
    });
  const tokenData = (await requestApi(cfBase, `/accounts/${accountId}/builds/tokens`, cfToken))
    .result as Json[];
  if (!tokenData.length)
    throw Error(
      "Create a Workers Builds deployment token in Cloudflare Settings > Builds first. Authorize the Cloudflare GitHub App there too.",
    );
  const buildTokenId = String(
    answer(
      await select({
        message: "Cloudflare managed build token",
        options: tokenData.map((t) => ({
          value: field(t.build_token_uuid),
          label: field(t.build_token_name),
        })),
      }),
    ),
  );
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
  const subdomain = field(
    object((await requestApi(cfBase, `/accounts/${accountId}/workers/subdomain`, cfToken)).result)
      .subdomain,
  );
  for (const environment of environments)
    for (const name of new Set(manifest.applications.flatMap((a) => [a.name, ...a.connections])))
      profile.urls[environment][name] = publicOrigin(
        await input(
          `${name}/${environment}: public HTTPS origin`,
          profile.urls[environment][name] ??
            (manifest.applications.some((a) => a.name === name) && subdomain
              ? `https://${manifest.applications.find((a) => a.name === name)?.worker}-${environment}.${subdomain}.workers.dev`
              : ""),
        ),
      );
  const neonToken = manifest.applications.some((a) => a.database)
    ? await credential("NEON_API_KEY")
    : "";
  for (const app of manifest.applications.filter((a) => a.database))
    profile.neonProjects[app.name] = await chooseNeonProject(
      app.name,
      neonToken,
      profile.neonProjects[app.name],
    );
  validateTopology(manifest, profile);
  console.log(
    `Target: ${accountId}; GitHub: ${repository}; apps: ${manifest.applications.map((a) => a.name).join(", ")}. This creates/updates Workers, build triggers and secrets. Existing databases are never reset or deleted.`,
  );
  if (!answer(await confirm({ message: "Apply this configuration?" }))) return;
  await mkdir(resolve(".nordixgen"), { recursive: true });
  const save = () =>
    writeFile(profilePath, `${JSON.stringify(profile, null, 2)}\n`, { mode: 0o600 });
  await save();
  await provisionNeonProjects(manifest, profile, neonToken, save);
  await configure(manifest, profile, cfToken, neonToken);
  console.log(
    "Setup complete. Push main/develop to run native Cloudflare builds; verify both builds and application URLs. See docs/DEPLOYMENT.md for routes and recovery.",
  );
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
