import { createHash } from "node:crypto";
import type { DeploymentManifest, DeploymentProfile } from "./deployment-model.js";
import { configureReviewEvents } from "./infrastructure-events.js";
import type { InfrastructureAccess } from "./infrastructure-setup.js";
type Json = Record<string, unknown>;
/** A dedicated native build runs plans only; it never publishes application code. */
export async function configureInfrastructureReview(
  manifest: DeploymentManifest,
  profile: DeploymentProfile,
  access: InfrastructureAccess,
  token: string,
  request: (path: string, method?: string, body?: unknown) => Promise<unknown>,
  repoConnection: string,
) {
  if (!manifest.infrastructure?.owner) return;
  const base = `https://api.cloudflare.com/client/v4/accounts/${profile.accountId}`;
  const raw = `${manifest.project}-infra-review`;
  const worker =
    raw.length <= 63
      ? raw
      : `${raw.slice(0, 52)}-${createHash("sha256").update(raw).digest("hex").slice(0, 10)}`;
  const scripts = (await request("/workers/scripts")) as Json[];
  let script = scripts.find((script) => script.id === worker);
  if (!script) {
    const form = new FormData();
    form.append(
      "metadata",
      JSON.stringify({ main_module: "index.mjs", compatibility_date: "2026-10-01" }),
    );
    form.append(
      "index.mjs",
      new Blob(["export default {fetch(){return new Response(null,{status:404})}}"], {
        type: "application/javascript+module",
      }),
      "index.mjs",
    );
    const response = await fetch(`${base}/workers/scripts/${worker}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    if (!response.ok)
      throw Error("Could not create the private infrastructure review build target");
    script = ((await response.json()) as { result: Json }).result;
  }
  await request(`/workers/scripts/${worker}/subdomain`, "POST", {
    enabled: false,
    previews_enabled: false,
  });
  const triggers = (await request(`/builds/workers/${script.tag}/triggers`)) as Json[];
  const existing = triggers.find(
    (trigger) => trigger.trigger_name === "NordixGen infrastructure review",
  );
  const config = {
    external_script_id: script.tag,
    repo_connection_uuid: repoConnection,
    build_token_uuid: profile.buildTokenId,
    trigger_name: "NordixGen infrastructure review",
    build_command: "node scripts/infra.mjs review",
    deploy_command: "node -e \"console.log('Infrastructure review complete')\"",
    root_directory: "/",
    branch_includes: ["main"],
    branch_excludes: [],
    path_includes: ["*", "**/*"],
    path_excludes: [],
  };
  const trigger = (await request(
    existing ? `/builds/triggers/${existing.trigger_uuid}` : "/builds/triggers",
    existing ? "PATCH" : "POST",
    config,
  )) as Json;
  const branches = triggers.find(
    (item) => item.trigger_name === "NordixGen infrastructure review branches",
  );
  const preview = (await request(
    branches ? `/builds/triggers/${branches.trigger_uuid}` : "/builds/triggers",
    branches ? "PATCH" : "POST",
    {
      ...config,
      trigger_name: "NordixGen infrastructure review branches",
      branch_includes: ["*"],
      branch_excludes: ["main"],
    },
  )) as Json;
  for (const target of [trigger, preview])
    await request(
      `/builds/triggers/${target.trigger_uuid}/environment_variables`,
      "PATCH",
      Object.fromEntries(
        Object.entries({ ...access.review, NODE_VERSION: "24", PNPM_VERSION: "10.5.2" }).map(
          ([key, value]) => [
            key,
            { value, is_secret: !["NODE_VERSION", "PNPM_VERSION"].includes(key) },
          ],
        ),
      ),
    );
  if (!access.eventsToken)
    throw Error(
      "Setup token requires Workers Builds Configuration Edit to configure PR event dispatch",
    );
  await configureReviewEvents(
    profile,
    worker,
    String(preview.trigger_uuid),
    token,
    access.eventsToken,
    request,
    String(trigger.trigger_uuid),
  );
}
