import type { ResolvedProject } from "../project/types.js";
import { frontendView } from "../project/views.js";
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
    ...(view.identity ? { authentication: view.identity } : {}),
  });
}
