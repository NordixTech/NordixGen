import {
  FRONTEND_PLUGIN_ROLES,
  type FrontendGeneratorPlugin,
  type FrontendPluginDescriptor,
  type FrontendPluginRole,
} from "./frontend-contracts.js";

const PLUGIN_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const CAPABILITY_PATTERN = /^[a-z][a-z0-9._:-]*$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

export class FrontendPluginRegistrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FrontendPluginRegistrationError";
  }
}

export function validateFrontendPluginDescriptor(
  value: unknown,
): value is FrontendPluginDescriptor {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const descriptor = value as Record<string, unknown>;
  if (typeof descriptor.id !== "string" || !PLUGIN_ID_PATTERN.test(descriptor.id)) return false;
  if (typeof descriptor.version !== "string" || !VERSION_PATTERN.test(descriptor.version))
    return false;
  if (
    typeof descriptor.role !== "string" ||
    !FRONTEND_PLUGIN_ROLES.includes(descriptor.role as FrontendPluginRole)
  )
    return false;
  if (
    !Array.isArray(descriptor.provides) ||
    !descriptor.provides.every(
      (capability) => typeof capability === "string" && CAPABILITY_PATTERN.test(capability),
    ) ||
    new Set(descriptor.provides).size !== descriptor.provides.length
  )
    return false;
  if (descriptor.dependencies !== undefined && !validateDependencyMap(descriptor.dependencies))
    return false;
  if (
    descriptor.devDependencies !== undefined &&
    !validateDependencyMap(descriptor.devDependencies)
  )
    return false;
  if (descriptor.requires === undefined) return true;
  return (
    Array.isArray(descriptor.requires) &&
    descriptor.requires.every(
      (requirement) =>
        requirement !== null &&
        typeof requirement === "object" &&
        !Array.isArray(requirement) &&
        "capability" in requirement &&
        typeof requirement.capability === "string" &&
        CAPABILITY_PATTERN.test(requirement.capability) &&
        (requirement.description === undefined || typeof requirement.description === "string"),
    )
  );
}

function validateDependencyMap(value: unknown): value is Record<string, string> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.entries(value).every(
      ([name, version]) =>
        name.trim().length > 0 && typeof version === "string" && version.trim().length > 0,
    )
  );
}

function validatePlugin(value: unknown): asserts value is FrontendGeneratorPlugin {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new FrontendPluginRegistrationError("A frontend plugin must be an object.");
  }
  const plugin = value as Partial<FrontendGeneratorPlugin>;
  if (!validateFrontendPluginDescriptor(plugin.descriptor)) {
    throw new FrontendPluginRegistrationError(
      "A frontend plugin must provide a valid identifier, semantic version, role, capabilities, and requirements.",
    );
  }
  if (typeof plugin.contribute !== "function") {
    throw new FrontendPluginRegistrationError(
      `Frontend plugin ${plugin.descriptor.id} must implement contribute().`,
    );
  }
  if (
    plugin.descriptor.role === "framework" &&
    typeof plugin.createFrameworkContext !== "function"
  ) {
    throw new FrontendPluginRegistrationError(
      `Frontend framework plugin ${plugin.descriptor.id} must implement createFrameworkContext().`,
    );
  }
}

/** Host-populated registry; frontend plugin implementations are never hard-coded in core. */
export class FrontendPluginRegistry {
  private readonly plugins = new Map<string, FrontendGeneratorPlugin>();

  register(plugin: FrontendGeneratorPlugin): void {
    validatePlugin(plugin);
    if (this.plugins.has(plugin.descriptor.id)) {
      throw new FrontendPluginRegistrationError(
        `Frontend plugin ${plugin.descriptor.id} is already registered.`,
      );
    }
    const descriptor = Object.freeze({
      ...plugin.descriptor,
      provides: Object.freeze([...plugin.descriptor.provides]),
      ...(plugin.descriptor.requires === undefined
        ? {}
        : {
            requires: Object.freeze(
              plugin.descriptor.requires.map((requirement) => Object.freeze({ ...requirement })),
            ),
          }),
      ...(plugin.descriptor.dependencies === undefined
        ? {}
        : { dependencies: Object.freeze({ ...plugin.descriptor.dependencies }) }),
      ...(plugin.descriptor.devDependencies === undefined
        ? {}
        : { devDependencies: Object.freeze({ ...plugin.descriptor.devDependencies }) }),
    });
    this.plugins.set(plugin.descriptor.id, { ...plugin, descriptor });
  }

  get(pluginId: string): FrontendGeneratorPlugin | undefined {
    return this.plugins.get(pluginId);
  }

  list(): FrontendPluginDescriptor[] {
    return [...this.plugins.values()]
      .map(({ descriptor }) => descriptor)
      .sort((left, right) => left.id.localeCompare(right.id));
  }
}
