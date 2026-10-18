import {
  buildFrontendApiContract,
  frontendRenderSettings,
} from "../plugins/frontend-api-contract.js";
import { composeFrontendPlugins } from "../plugins/frontend-composer.js";
import { FrontendPluginRegistry } from "../plugins/frontend-registry.js";
import { betterAuthFrontendPlugin } from "../plugins/frontends/better-auth-client.js";
import { zustandClientStatePlugin } from "../plugins/frontends/client-state.js";
import { featureScreensFrontendPlugin } from "../plugins/frontends/feature-screens.js";
import { nativeReactUiPlugin } from "../plugins/frontends/native-ui.js";
import { nextjsFrontendPlugin } from "../plugins/frontends/nextjs.js";
import { tanstackQueryServerStatePlugin } from "../plugins/frontends/server-state.js";
import { typedFetchApiPlugin } from "../plugins/frontends/typed-api-client.js";
import { tailwindStylingPlugin } from "../plugins/styling/tailwind.js";
import type { ResolvedProject } from "../project/types.js";
/** Existing frontend assembly; replaced by the dedicated direct frontend change. */
export function generateFrontend(project: ResolvedProject, name: string) {
  const registry = new FrontendPluginRegistry();
  for (const plugin of [
    nextjsFrontendPlugin,
    tailwindStylingPlugin,
    nativeReactUiPlugin,
    typedFetchApiPlugin,
    tanstackQueryServerStatePlugin,
    zustandClientStatePlugin,
    betterAuthFrontendPlugin,
    featureScreensFrontendPlugin,
  ])
    registry.register(plugin);
  return composeFrontendPlugins(
    project.project.name,
    frontendRenderSettings(project, name),
    registry,
    buildFrontendApiContract(project, name),
  );
}
