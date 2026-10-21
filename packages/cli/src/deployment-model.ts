export type Environment = "staging" | "production";
export interface DeploymentApplication {
  storage?: string[];
  name: string;
  path: string;
  worker: string;
  kind: "backend" | "frontend";
  database: boolean;
  identity: boolean;
  connections: string[];
  identityBackend?: string;
  runtimeKeys: string[];
  emailDelivery?: boolean;
}
export interface DeploymentManifest {
  publicFrontends?: Record<
    string,
    { worker: string; connections: string[]; identityBackend?: string }
  >;
  infrastructure?: {
    owner: boolean;
    statePrefix: string;
    stateBucket: string;
    backends: Record<string, { worker: string; storage: string[] }>;
  };
  version: 1;
  project: string;
  repository: string;
  applications: DeploymentApplication[];
}
export interface DeploymentProfile {
  stateBucket?: string;
  accountId: string;
  repository: string;
  buildTokenId: string;
  neonProjects: Record<string, string>;
  urls: Record<Environment, Record<string, string>>;
}
