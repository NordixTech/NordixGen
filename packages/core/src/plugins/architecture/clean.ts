import type {
  ArchitectureLayout,
  FrameworkContext,
  GeneratorPlugin,
  PluginSelection,
} from "../contracts.js";
import { generateDomainFiles } from "./domain-files.js";

const CLEAN_DIRECTORIES: ArchitectureLayout["directories"] = Object.freeze({
  domainEntity: "domain/entities",
  useCase: "application/use-cases",
  inboundPort: "application/ports/inbound",
  outboundPort: "application/ports/outbound",
  adapter: "infrastructure/adapters",
  controller: "presentation/controllers",
  infrastructure: "infrastructure",
});

const CLEAN_DEPENDENCY_RULES: ArchitectureLayout["dependencyRules"] = Object.freeze([
  { from: "controller", to: "inboundPort" },
  { from: "useCase", to: "inboundPort" },
  { from: "useCase", to: "outboundPort" },
  { from: "useCase", to: "domainEntity" },
  { from: "adapter", to: "outboundPort" },
  { from: "adapter", to: "domainEntity" },
  { from: "infrastructure", to: "adapter" },
]);

/** Resolves Clean Architecture locations relative to the selected framework's code root. */
export function resolveCleanArchitectureLayout(
  framework: FrameworkContext,
  _selection?: PluginSelection,
): ArchitectureLayout {
  return {
    pluginId: "clean",
    codeRoot: framework.codeRoot,
    directories: CLEAN_DIRECTORIES,
    dependencyRules: CLEAN_DEPENDENCY_RULES,
  };
}

/** Framework- and ORM-independent Clean Architecture strategy. */
export const cleanArchitecturePlugin: GeneratorPlugin = {
  descriptor: {
    id: "clean",
    version: "1.0.0",
    role: "architecture",
    provides: ["architecture:clean"],
  },
  resolveArchitectureLayout: resolveCleanArchitectureLayout,
  contribute: generateDomainFiles,
};
