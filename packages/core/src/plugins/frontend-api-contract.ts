import type { ResolvedProject } from "../project/types.js";
import { frontendView } from "../project/views.js";
import type { FrontendRenderSettings } from "./frontend-contracts.js";
import type { FrontendApiContract } from "./frontend-contracts.js";

/** Temporary concrete renderer adapter; all business interpretation belongs to resolution. */
export function buildFrontendApiContract(
  project: ResolvedProject,
  name: string,
): FrontendApiContract {
  const view = frontendView(project, name);
  return Object.freeze({
    endpoints: view.endpoints,
    operationNames: view.operationNames,
    features: view.features,
    entities: view.entities,
    enums: project.enums,
    ...(view.identity
      ? { authentication: Object.freeze({ ...view.identity, plugin: "better-auth" as const }) }
      : {}),
  });
}
export function frontendRenderSettings(
  project: ResolvedProject,
  name: string,
): FrontendRenderSettings {
  const view = frontendView(project, name);
  return {
    name: view.name,
    repository: view.repository.name,
    path: view.path,
    connectsTo: [...view.connections],
    access: {
      ...view.access,
      ...(view.access.publicRoutes
        ? { publicRoutes: [...view.access.publicRoutes] }
        : { publicRoutes: undefined }),
    },
    framework: "nextjs",
    type: "web",
    styling: "tailwind",
    ui: "native",
    authUI: Boolean(view.identity),
    stateManagement: {
      client: "zustand",
      server: "tanstack-query",
      generateHooks: true,
      optimisticUpdates: false,
    },
  };
}
