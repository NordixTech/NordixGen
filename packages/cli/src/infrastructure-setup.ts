import { createHash } from "node:crypto";
import { execa } from "execa";
import type { DeploymentManifest, DeploymentProfile } from "./deployment-model.js";
import { InfrastructureRunner } from "./infrastructure-runner.js";
type Json = Record<string, unknown>;
type Api = (path: string, method?: string, body?: unknown) => Promise<Json>;
export interface InfrastructureAccess {
  build: Record<string, string>;
  review: Record<string, string>;
  eventsToken: string;
}
/** Reuse the authorized setup token for infrastructure and PR plans; do not create extra admin/review keys. */
export async function prepareInfrastructure(
  manifest: DeploymentManifest,
  profile: DeploymentProfile,
  token: string,
  api: Api,
  askSecret: (label: string) => Promise<string>,
  registerSecret: (value: string) => void,
): Promise<InfrastructureAccess | undefined> {
  const infrastructure = manifest.infrastructure;
  if (!infrastructure) return undefined;
  const account = profile.accountId;
  const bucket = profile.stateBucket ?? infrastructure.stateBucket;
  const existing = (await api(`/accounts/${account}/r2/buckets`)) as {
    result?: { buckets?: { name: string }[] };
  };
  if (!existing.result?.buckets?.some((item) => item.name === bucket))
    await api(`/accounts/${account}/r2/buckets`, "POST", { name: bucket });
  profile.stateBucket = bucket;
  const verified = (await api("/user/tokens/verify")).result as { id?: string; status?: string };
  if (!verified.id || verified.status !== "active")
    throw Error("Infrastructure needs the active user deployment token");
  // Cloudflare documents this S3 representation of an existing token. It creates no new API token.
  const s3Secret = createHash("sha256").update(token).digest("hex");
  registerSecret(s3Secret);
  let github = process.env.INFRA_GITHUB_TOKEN;
  if (!github) {
    try {
      github = (
        await execa("gh", ["auth", "token"], { stdout: "pipe", stderr: "pipe" })
      ).stdout.trim();
    } catch {}
  }
  if (!github)
    github = await askSecret(
      "GitHub token for repository reads and PR comments (Contents Read, Pull requests Write)",
    );
  registerSecret(github);
  const build = {
    CLOUDFLARE_ACCOUNT_ID: account,
    R2_STATE_BUCKET: bucket,
    R2_STATE_ACCESS_KEY_ID: verified.id,
    R2_STATE_SECRET_ACCESS_KEY: s3Secret,
    CLOUDFLARE_API_TOKEN: token,
    INFRA_GITHUB_TOKEN: github,
    INFRA_GITHUB_REPOSITORY: profile.repository,
  };
  const old = new Map<string, string | undefined>();
  for (const [name, value] of Object.entries(build)) {
    old.set(name, process.env[name]);
    process.env[name] = value;
  }
  try {
    if (infrastructure.owner)
      for (const environment of ["staging", "production"] as const)
        await new InfrastructureRunner(manifest, environment).apply();
  } finally {
    for (const [name, value] of old) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
  return { build, review: { ...build }, eventsToken: token };
}
