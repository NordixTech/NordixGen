import { readFile } from "node:fs/promises";
import {
  type ResolvedProject,
  cloudflareWorkerName,
  r2BucketName,
} from "@nordix-tech/nordixgen-core";

/** Infrastructure ownership is project-wide: shared buckets are never duplicated across repositories. */
export function infrastructureManifest(project: ResolvedProject, repository: string) {
  const storage = project.iac?.cloudflare.r2_storage;
  if (!storage || !Object.keys(storage).length) return undefined;
  const owner = project.iac?.repository ?? project.repositories[0].name;
  return {
    owner: repository === owner,
    statePrefix: project.project.name,
    stateBucket: `${cloudflareWorkerName(project.project.name, "infra-state")}`,
    backends: Object.fromEntries(
      Object.values(project.backends).map((app) => [
        app.name,
        { worker: cloudflareWorkerName(project.project.name, app.name), storage: [...app.storage] },
      ]),
    ),
  };
}
export async function infrastructureFiles(
  project: ResolvedProject,
  repository: string,
): Promise<Record<string, string>> {
  const manifest = infrastructureManifest(project, repository);
  if (!manifest) return {};
  const bundle = new URL(
    import.meta.url.includes("/src/")
      ? "../dist/infrastructure-runner.js"
      : "./infrastructure-runner.js",
    import.meta.url,
  );
  const files: Record<string, string> = { "scripts/infra.mjs": await readFile(bundle, "utf8") };
  if (!manifest.owner) return files;
  files["infra/terraform/versions.tf"] = `terraform {
 required_version = ">= 1.11.0, < 2.0.0"
 required_providers { cloudflare = { source = "cloudflare/cloudflare", version = "= 5.12.0" } }
 backend "s3" {}
}
provider "cloudflare" {}
variable "account_id" { type = string }
variable "environment" { type = string }
variable "public_domains" {
 type = map(object({ domain = string, zone_id = string }))
 default = {}
}
variable "storage_upload_origins" {
 type = map(list(string))
 default = {}
}
`;
  const storage = project.iac?.cloudflare.r2_storage ?? {};
  // Each resource has a stable logical address. Developers edit these files after generation.
  files["infra/terraform/r2.tf"] = Object.entries(storage)
    .map(
      ([key, config]) => `resource "cloudflare_r2_bucket" "${key}" {
 account_id = var.account_id
 name = var.environment == "staging" ? ${JSON.stringify(r2BucketName(project.project.name, "staging", key))} : ${JSON.stringify(r2BucketName(project.project.name, "production", key))}
}
resource "cloudflare_r2_bucket_cors" "${key}" {
 count = length(lookup(var.storage_upload_origins, "${key}", [])) > 0 ? 1 : 0
 account_id = var.account_id
 bucket_name = cloudflare_r2_bucket.${key}.name
 rules = [{
  id = "direct-upload"
  allowed = {
   origins = var.storage_upload_origins["${key}"]
   methods = ["PUT"]
   headers = ["content-type", "if-none-match"]
  }
  expose_headers = ["ETag"]
  max_age_seconds = 3600
 }]
}
${
  config.visibility === "public"
    ? `resource "cloudflare_r2_custom_domain" "${key}" {
 account_id = var.account_id
 bucket_name = cloudflare_r2_bucket.${key}.name
 domain = var.public_domains["${key}"].domain
 zone_id = var.public_domains["${key}"].zone_id
 enabled = true
}
`
    : ""
}`,
    )
    .join("\n");
  files["infra/terraform/outputs.tf"] =
    `# Keep this output contract when adding resources and backend associations.
output "storage" { value = {
${Object.entries(manifest.backends)
  .map(
    ([backend, app]) => ` ${JSON.stringify(backend)} = {
${app.storage.map((key) => `  ${JSON.stringify(key)} = { binding = ${JSON.stringify(key.toUpperCase())}, bucket = cloudflare_r2_bucket.${key}.name, public_url = ${storage[key].visibility === "public" ? `"https://\${var.public_domains[${JSON.stringify(key)}].domain}"` : "null"} }`).join("\n")}
 }`,
  )
  .join("\n")}
} }
`;
  for (const environment of ["staging", "production"])
    files[`infra/terraform/${environment}.tfvars`] =
      `environment = "${environment}"\n# For each public bucket, set public_domains with its domain and Cloudflare zone_id.\n# Direct browser uploads: storage_upload_origins = { documents = ["https://app.example.com"] }\n# cicd:setup supplies the connected frontend origins automatically via TF_VAR_storage_upload_origins.\n`;
  files["infra/terraform/.gitignore"] =
    ".terraform/\n*.tfstate*\n*.tfplan\n*.plan.json\nbackend.generated.hcl\n";
  return files;
}
