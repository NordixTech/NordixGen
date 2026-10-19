export type Environment = "staging" | "production";
export interface DeploymentApplication {
  name: string;
  path: string;
  worker: string;
  kind: "backend" | "frontend";
  database: boolean;
  identity: boolean;
  connections: string[];
  identityBackend?: string;
  runtimeKeys: string[];
}
export interface DeploymentManifest {
  version: 1;
  project: string;
  repository: string;
  applications: DeploymentApplication[];
}
export interface DeploymentProfile {
  accountId: string;
  repository: string;
  buildTokenId: string;
  neonProjects: Record<string, string>;
  urls: Record<Environment, Record<string, string>>;
}
