import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { AwsClient } from "aws4fetch";
import { execa } from "execa";
import { XMLParser } from "fast-xml-parser";
import { parse } from "jsonc-parser";
import type { DeploymentManifest, Environment } from "./deployment-model.js";

const version = "1.11.0";
type StorageOutput = Record<
  string,
  Record<string, { binding: string; bucket: string; public_url: string | null }>
>;
export interface ResourceChange {
  address: string;
  type: string;
  change: { actions: string[]; before?: Record<string, unknown>; after?: Record<string, unknown> };
}
export interface InfraPlan {
  resource_changes?: ResourceChange[];
}
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const xml = new XMLParser({ parseTagValue: false, ignoreAttributes: false, processEntities: true });
const required = (name: string) => {
  const value = process.env[name];
  if (!value) throw Error(`Missing ${name}. Rerun cicd:setup.`);
  return value;
};
export function stateKey(manifest: DeploymentManifest, environment: Environment) {
  if (!manifest.infrastructure) throw Error("This repository has no infrastructure configuration");
  if (!["staging", "production"].includes(environment)) throw Error("Choose staging or production");
  return `${manifest.infrastructure.statePrefix}/${environment}`;
}
export async function tofuExecutable() {
  if (process.env.TOFU_BIN) return process.env.TOFU_BIN;
  try {
    await execa("tofu", ["version", "-json"]);
    return "tofu";
  } catch {}
  const platform =
    process.platform === "win32"
      ? "windows"
      : process.platform === "linux"
        ? "linux"
        : process.platform === "darwin"
          ? "darwin"
          : "";
  const arch = process.arch === "x64" ? "amd64" : process.arch === "arm64" ? "arm64" : "";
  if (!platform || !arch) throw Error("Install OpenTofu 1.11+ and set TOFU_BIN for this platform");
  const directory = resolve(".nordixgen", "tools", version);
  await mkdir(directory, { recursive: true });
  const binary = join(directory, platform === "windows" ? "tofu.exe" : "tofu");
  try {
    await execa(binary, ["version", "-json"]);
    return binary;
  } catch {}
  const name = `tofu_${version}_${platform}_${arch}.zip`;
  const base = `https://github.com/opentofu/opentofu/releases/download/v${version}`;
  const [archive, checksums] = await Promise.all([
    fetch(`${base}/${name}`),
    fetch(`${base}/tofu_${version}_SHA256SUMS`),
  ]);
  if (!archive.ok || !checksums.ok)
    throw Error("Could not download pinned OpenTofu from its official release");
  const bytes = new Uint8Array(await archive.arrayBuffer());
  const digest = createHash("sha256").update(bytes).digest("hex");
  const line = (await checksums.text()).split("\n").find((line) => line.trim().endsWith(name));
  if (!line || line.split(/\s+/)[0] !== digest) throw Error("OpenTofu download checksum mismatch");
  const zip = join(directory, name);
  await writeFile(zip, bytes);
  await execa(
    platform === "windows" ? "tar" : "unzip",
    platform === "windows" ? ["-xf", zip, "-C", directory] : ["-o", zip, "-d", directory],
  );
  if (platform !== "windows") await chmod(binary, 0o700);
  return binary;
}
export class InfrastructureRunner {
  private readonly s3: AwsClient;
  private readonly endpoint: string;
  private async dataClient() {
    return new AwsClient({
      accessKeyId: required("R2_STATE_ACCESS_KEY_ID"),
      secretAccessKey: required("R2_STATE_SECRET_ACCESS_KEY"),
      service: "s3",
      region: "auto",
    });
  }
  constructor(
    readonly manifest: DeploymentManifest,
    readonly environment: Environment,
  ) {
    stateKey(manifest, environment);
    this.s3 = new AwsClient({
      accessKeyId: required("R2_STATE_ACCESS_KEY_ID"),
      secretAccessKey: required("R2_STATE_SECRET_ACCESS_KEY"),
      service: "s3",
      region: "auto",
    });
    this.endpoint = `https://${required("CLOUDFLARE_ACCOUNT_ID")}.r2.cloudflarestorage.com`;
  }
  private async object(key: string, init: RequestInit = {}) {
    return this.s3.fetch(`${this.endpoint}/${required("R2_STATE_BUCKET")}/${key}`, init);
  }
  private async command(args: string[]) {
    const executable = await tofuExecutable();
    try {
      return (
        await execa(executable, ["-chdir=infra/terraform", ...args], {
          env: {
            TF_IN_AUTOMATION: "1",
            TF_INPUT: "0",
            AWS_ACCESS_KEY_ID: required("R2_STATE_ACCESS_KEY_ID"),
            AWS_SECRET_ACCESS_KEY: required("R2_STATE_SECRET_ACCESS_KEY"),
            AWS_REGION: "auto",
            TF_VAR_account_id: required("CLOUDFLARE_ACCOUNT_ID"),
            ...(process.env.R2_UPLOAD_ORIGINS
              ? {
                  TF_VAR_storage_upload_origins: JSON.stringify(
                    JSON.parse(process.env.R2_UPLOAD_ORIGINS)[this.environment] ?? {},
                  ),
                }
              : {}),
          },
          stdout: "pipe",
          stderr: "pipe",
        })
      ).stdout;
    } catch {
      throw Error(
        `OpenTofu ${args[0]} failed. Inspect configuration, provider permissions and remote state; raw provider output is withheld to protect secrets.`,
      );
    }
  }
  async initialize() {
    const bucket = required("R2_STATE_BUCKET");
    if (!/^[a-z0-9-]+$/.test(bucket)) throw Error("Invalid state bucket name");
    await this.command([
      "init",
      "-input=false",
      "-reconfigure",
      `-backend-config=bucket=${bucket}`,
      `-backend-config=key=${stateKey(this.manifest, this.environment)}/terraform.tfstate`,
      `-backend-config=endpoints={s3="${this.endpoint}"}`,
      "-backend-config=region=auto",
      "-backend-config=skip_credentials_validation=true",
      "-backend-config=skip_requesting_account_id=true",
      "-backend-config=skip_region_validation=true",
      "-backend-config=skip_metadata_api_check=true",
      "-backend-config=skip_s3_checksum=true",
      "-backend-config=use_path_style=true",
      "-backend-config=use_lockfile=true",
    ]);
  }
  async plan(): Promise<InfraPlan> {
    await this.initialize();
    await this.command([
      "plan",
      "-input=false",
      "-lock=false",
      `-var-file=${this.environment}.tfvars`,
      "-out=changes.tfplan",
    ]);
    return JSON.parse(await this.command(["show", "-json", "changes.tfplan"])) as InfraPlan;
  }
  async bucketStatus(bucket: string): Promise<"empty" | "contains files" | "not verified"> {
    try {
      const response = await (await this.dataClient()).fetch(
        `${this.endpoint}/${encodeURIComponent(bucket)}?list-type=2&max-keys=1`,
      );
      if (!response.ok) return "not verified";
      const result = xml.parse(await response.text()).ListBucketResult;
      return result?.Contents ? "contains files" : "empty";
    } catch {
      return "not verified";
    }
  }
  /** Only buckets that the exact saved plan deletes may be emptied. */
  async emptyDeletedBuckets(plan: InfraPlan) {
    for (const resource of plan.resource_changes ?? []) {
      if (resource.type !== "cloudflare_r2_bucket" || !resource.change.actions.includes("delete"))
        continue;
      const bucket = String(resource.change.before?.name ?? "");
      if (
        !bucket ||
        resource.change.before?.account_id !== required("CLOUDFLARE_ACCOUNT_ID") ||
        bucket === required("R2_STATE_BUCKET")
      )
        throw Error("Refusing to empty a bucket outside the planned application infrastructure");
      for (;;) {
        const client = await this.dataClient();
        const response = await client.fetch(
          `${this.endpoint}/${encodeURIComponent(bucket)}?list-type=2&max-keys=500`,
        );
        if (response.status === 404) break;
        if (!response.ok) throw Error("Could not list a bucket scheduled for removal");
        const contents = xml.parse(await response.text()).ListBucketResult?.Contents;
        if (!contents) break;
        const objects = Array.isArray(contents) ? contents : [contents];
        // No object names or contents are logged or added to PR comments.
        for (const object of objects) {
          const key = String(object.Key);
          const result = await client.fetch(
            `${this.endpoint}/${encodeURIComponent(bucket)}/${key.split("/").map(encodeURIComponent).join("/")}`,
            { method: "DELETE" },
          );
          if (!result.ok)
            throw Error("Could not remove an object from a bucket scheduled for removal");
        }
      }
    }
  }
  async outputs(): Promise<StorageOutput> {
    return JSON.parse(await this.command(["output", "-json", "storage"])) as StorageOutput;
  }
  private async signingCredentials(outputs: StorageOutput) {
    const account = required("CLOUDFLARE_ACCOUNT_ID");
    const token = required("CLOUDFLARE_API_TOKEN");
    const api = async (path: string, method = "GET", body?: unknown) => {
      const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!response.ok)
        throw Error(`Could not synchronize scoped R2 transfer credentials (${response.status})`);
      return ((await response.json()) as { result: Record<string, unknown> }).result;
    };
    const key = `${stateKey(this.manifest, this.environment)}/signing.json`;
    const response = await this.object(key);
    const saved = response.ok
      ? ((await response.json()) as Record<string, { id: string; path: string; hash: string }>)
      : {};
    let tokenPath = "/user/tokens";
    try {
      await api(`${tokenPath}/permission_groups`);
    } catch {
      tokenPath = `/accounts/${account}/tokens`;
    }
    for (const [backend, credential] of Object.entries(saved)) {
      if (
        this.manifest.infrastructure?.backends[backend] &&
        Object.keys(outputs[backend] ?? {}).length
      )
        continue;
      await api(`${credential.path}/${credential.id}`, "DELETE");
      const app = this.manifest.infrastructure?.backends[backend];
      if (app)
        for (const name of ["R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"])
          await api(
            `/accounts/${account}/workers/scripts/${app.worker}-${this.environment}/secrets/${name}`,
            "DELETE",
          );
      delete saved[backend];
    }
    for (const [backend, storage] of Object.entries(outputs)) {
      const app = this.manifest.infrastructure?.backends[backend];
      if (!app) continue;
      const worker = `${app.worker}-${this.environment}`;
      const resources = Object.fromEntries(
        Object.values(storage).map((value) => [
          `com.cloudflare.edge.r2.bucket.${account}_default_${value.bucket}`,
          "*",
        ]),
      );
      if (!Object.keys(resources).length) continue;
      // Version the policy hash so existing download-only credentials are upgraded on apply.
      const hash = createHash("sha256")
        .update(`direct-upload-v1:${JSON.stringify(resources)}`)
        .digest("hex");
      const policies = [
        {
          effect: "allow",
          permission_groups: [
            { id: "6a018a9f2fc74eb6b293b0c548f38b39" },
            { id: "2efd5506f9c8494dacb1fa10a3e7d5b6" },
          ],
          resources,
        },
      ];
      if (saved[backend]) {
        if (saved[backend].hash !== hash)
          await api(`${saved[backend].path}/${saved[backend].id}`, "PUT", {
            name: `${this.manifest.project} ${backend} ${this.environment} storage transfers`,
            policies,
          });
        saved[backend].hash = hash;
        continue;
      }
      // Bootstrap before uploading secrets. A private 503 placeholder never serves user data.
      const scripts = (await api(`/accounts/${account}/workers/scripts`)) as unknown as {
        id: string;
      }[];
      if (!scripts.some((script) => script.id === worker)) {
        const form = new FormData();
        form.append(
          "metadata",
          JSON.stringify({ main_module: "bootstrap.mjs", compatibility_date: "2026-10-01" }),
        );
        form.append(
          "bootstrap.mjs",
          new Blob(["export default {fetch(){return new Response(null,{status:503})}}"], {
            type: "application/javascript+module",
          }),
          "bootstrap.mjs",
        );
        const created = await fetch(
          `https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/${worker}`,
          { method: "PUT", headers: { Authorization: `Bearer ${token}` }, body: form },
        );
        if (!created.ok) throw Error("Could not bootstrap storage consumer");
      }
      await api(`/accounts/${account}/workers/scripts/${worker}/subdomain`, "POST", {
        enabled: false,
        previews_enabled: false,
      });
      const credential = (await api(tokenPath, "POST", {
        name: `${this.manifest.project} ${backend} ${this.environment} storage transfers`,
        policies,
      })) as { id: string; value: string };
      if (!credential.id || !credential.value)
        throw Error("Scoped transfer credential was not returned");
      for (const [name, value] of Object.entries({
        R2_ACCESS_KEY_ID: credential.id,
        R2_SECRET_ACCESS_KEY: createHash("sha256").update(credential.value).digest("hex"),
      }))
        await api(`/accounts/${account}/workers/scripts/${worker}/secrets`, "PUT", {
          name,
          text: value,
          type: "secret_text",
        });
      saved[backend] = { id: credential.id, path: tokenPath, hash };
    }
    const result = await this.object(key, { method: "PUT", body: JSON.stringify(saved) });
    if (!result.ok) throw Error("Could not save transfer credential identifiers");
  }
  async syncBindings(outputs: StorageOutput) {
    for (const app of this.manifest.applications.filter((app) => app.kind === "backend")) {
      const file = join(app.path, "wrangler.jsonc");
      const config = parse(await readFile(file, "utf8"));
      config.env ??= {};
      config.env[this.environment] ??= {};
      const resources = outputs[app.name] ?? {};
      config.env[this.environment].r2_buckets = Object.values(resources).map((value) => ({
        binding: value.binding,
        bucket_name: value.bucket,
      }));
      config.env[this.environment].vars = {
        ...config.env[this.environment].vars,
        R2_ACCOUNT_ID: required("CLOUDFLARE_ACCOUNT_ID"),
        R2_BINDINGS: JSON.stringify(
          Object.fromEntries(Object.entries(resources).map(([key, value]) => [key, value.binding])),
        ),
        R2_BUCKETS: JSON.stringify(
          Object.fromEntries(Object.entries(resources).map(([key, value]) => [key, value.bucket])),
        ),
        R2_PUBLIC_URLS: JSON.stringify(
          Object.fromEntries(
            Object.entries(resources)
              .filter(([, value]) => value.public_url)
              .map(([key, value]) => [key, value.public_url]),
          ),
        ),
      };
      await writeFile(file, `${JSON.stringify(config, null, 2)}\n`);
    }
  }
  async apply() {
    const prefix = stateKey(this.manifest, this.environment);
    const lock = `${prefix}/apply.lock`;
    const commit =
      process.env.WORKERS_CI_COMMIT_SHA ?? (await execa("git", ["rev-parse", "HEAD"])).stdout;
    const deadline = Date.now() + 15 * 60_000;
    for (;;) {
      const response = await this.object(lock, {
        method: "PUT",
        headers: { "If-None-Match": "*" },
        body: JSON.stringify({ commit, id: randomUUID(), createdAt: new Date().toISOString() }),
      });
      if (response.ok) break;
      if (response.status !== 412 && response.status !== 409)
        throw Error("Could not acquire infrastructure lock");
      if (Date.now() > deadline)
        throw Error(
          "Infrastructure lock is still held. Inspect the active build before manually removing a stale lock.",
        );
      await wait(3000);
    }
    try {
      const marker = await this.object(`${prefix}/applied.json`);
      const previous = marker.ok
        ? ((await marker.json()) as { commit: string; outputs: StorageOutput })
        : undefined;
      if (process.env.WORKERS_CI_BRANCH) {
        const token = required("INFRA_GITHUB_TOKEN");
        const response = await fetch(
          `https://api.github.com/repos/${required("INFRA_GITHUB_REPOSITORY")}/branches/${this.environment === "staging" ? "develop" : "main"}`,
          { headers: { Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28" } },
        );
        if (!response.ok) throw Error("Could not verify the latest deployment commit");
        const tip = (await response.json()) as { commit: { sha: string } };
        if (tip.commit.sha !== commit)
          throw Error(
            "This build was superseded by a newer commit; its infrastructure will not be applied",
          );
      }
      if (previous?.commit === commit) {
        await this.syncBindings(previous.outputs);
        return;
      }
      if (!this.manifest.infrastructure?.owner)
        throw Error("Apply infrastructure in its owning repository first");
      const plan = await this.plan();
      await this.emptyDeletedBuckets(plan);
      await this.command(["apply", "-input=false", "-lock-timeout=5m", "changes.tfplan"]);
      const outputs = await this.outputs();
      await this.signingCredentials(outputs);
      const saved = await this.object(`${prefix}/applied.json`, {
        method: "PUT",
        body: JSON.stringify({ commit, outputs, appliedAt: new Date().toISOString() }),
      });
      if (!saved.ok)
        throw Error("Infrastructure applied but its deployment marker could not be saved");
      await this.syncBindings(outputs);
    } finally {
      const result = await this.object(lock, { method: "DELETE" });
      if (!result.ok)
        console.error(
          "Infrastructure lock could not be released; inspect the active build and state bucket before retrying.",
        );
      await unlink("infra/terraform/changes.tfplan").catch(() => {});
    }
  }
  async consume() {
    const response = await this.object(`${stateKey(this.manifest, this.environment)}/applied.json`);
    if (!response.ok)
      throw Error("Deploy the infrastructure-owning repository before this repository");
    const marker = (await response.json()) as { outputs: StorageOutput };
    await this.syncBindings(marker.outputs);
  }
  async review() {
    const repository = required("INFRA_GITHUB_REPOSITORY");
    const token = required("INFRA_GITHUB_TOKEN");
    const branch = required("WORKERS_CI_BRANCH");
    const api = async (path: string, method = "GET", body?: unknown) => {
      const response = await fetch(`https://api.github.com/repos/${repository}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!response.ok) throw Error(`GitHub infrastructure review failed (${response.status})`);
      return response.json();
    };
    const owner = repository.split("/")[0];
    const pulls = (await api(
      `/pulls?state=open&head=${encodeURIComponent(`${owner}:${branch}`)}`,
    )) as {
      number: number;
      head: { sha: string; repo: { full_name: string } };
      base: { ref: string };
    }[];
    for (const pr of pulls) {
      if (pr.head.repo.full_name !== repository || !["develop", "main"].includes(pr.base.ref))
        continue;
      if (pr.head.sha !== process.env.WORKERS_CI_COMMIT_SHA) continue;
      const target: Environment = pr.base.ref === "develop" ? "staging" : "production";
      const runner =
        target === this.environment ? this : new InfrastructureRunner(this.manifest, target);
      const plan = await runner.plan();
      const rows = [];
      for (const resource of plan.resource_changes ?? []) {
        if (resource.change.actions.every((action) => action === "no-op" || action === "read"))
          continue;
        const destructive = resource.change.actions.includes("delete");
        const status =
          destructive && resource.type === "cloudflare_r2_bucket"
            ? await runner.bucketStatus(String(resource.change.before?.name))
            : undefined;
        rows.push(
          `| \`${resource.address.replaceAll("|", "")}\` | ${resource.change.actions.join(" → ")} | ${status ?? "—"} |`,
        );
      }
      const tag = `<!-- nordixgen-infra-${target} -->`;
      const body = [
        tag,
        `### Infrastructure — ${target}`,
        `Commit: \`${pr.head.sha}\` · Checked: ${new Date().toISOString()}`,
        "",
        rows.length
          ? `| Resource | Change | Bucket contents |\n| --- | --- | --- |\n${rows.join("\n")}`
          : "No infrastructure changes.",
        "",
        "**Merging applies these changes automatically. Bucket deletions/replacements also delete their stored files.**",
        "The bucket check reflects this moment only; new files may arrive before deployment.",
      ].join("\n");
      const comments = (await api(`/issues/${pr.number}/comments?per_page=100`)) as {
        id: number;
        body: string;
        user: { login: string };
      }[];
      const existing = comments.find((comment) => comment.body.includes(tag));
      await api(
        existing ? `/issues/comments/${existing.id}` : `/issues/${pr.number}/comments`,
        existing ? "PATCH" : "POST",
        { body },
      );
    }
  }
}
export async function infrastructureStage(manifest: DeploymentManifest, environment: Environment) {
  if (!manifest.infrastructure) return;
  const runner = new InfrastructureRunner(manifest, environment);
  if (manifest.infrastructure.owner) await runner.apply();
  else await runner.consume();
}
export async function runInfrastructureCli() {
  const manifest = JSON.parse(
    await readFile("nordixgen.deployment.json", "utf8"),
  ) as DeploymentManifest;
  const command = process.argv[2];
  const environment = (process.argv[3] ?? "staging") as Environment;
  const runner = new InfrastructureRunner(manifest, environment);
  if (command === "review") await runner.review();
  else if (command === "apply") {
    if (
      process.env.WORKERS_CI_BRANCH &&
      process.env.WORKERS_CI_BRANCH !== (environment === "staging" ? "develop" : "main")
    )
      throw Error("Wrong deployment branch");
    await infrastructureStage(manifest, environment);
  } else if (command === "plan") {
    const plan = await runner.plan();
    console.log(
      (plan.resource_changes ?? []).map((change) => ({
        resource: change.address,
        actions: change.change.actions,
      })),
    );
  } else throw Error("Usage: node scripts/infra.mjs plan|apply|review staging|production");
}
