import {
  type GeneratorPlugin,
  PLUGIN_ROLES,
  type PluginCapabilityRequirement,
  type PluginDescriptor,
  type PluginRole,
} from "./contracts.js";

const PLUGIN_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const CAPABILITY_PATTERN = /^[a-z][a-z0-9._:-]*$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

export class PluginRegistrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PluginRegistrationError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isCapabilityRequirement(value: unknown): value is PluginCapabilityRequirement {
  if (!isRecord(value) || typeof value.capability !== "string") return false;
  if (value.optional !== undefined && typeof value.optional !== "boolean") return false;
  return value.description === undefined || typeof value.description === "string";
}

export function validatePluginDescriptor(value: unknown): value is PluginDescriptor {
  if (!isRecord(value)) return false;
  if (typeof value.id !== "string" || !PLUGIN_ID_PATTERN.test(value.id)) return false;
  if (typeof value.version !== "string" || !VERSION_PATTERN.test(value.version)) return false;
  if (typeof value.role !== "string" || !PLUGIN_ROLES.includes(value.role as PluginRole))
    return false;
  if (
    !Array.isArray(value.provides) ||
    !value.provides.every(
      (capability) => typeof capability === "string" && CAPABILITY_PATTERN.test(capability),
    )
  )
    return false;
  if (new Set(value.provides).size !== value.provides.length) return false;
  if (value.requires === undefined) return true;
  return (
    Array.isArray(value.requires) &&
    value.requires.every(
      (requirement) =>
        isCapabilityRequirement(requirement) && CAPABILITY_PATTERN.test(requirement.capability),
    )
  );
}

function validatePlugin(plugin: unknown): asserts plugin is GeneratorPlugin {
  if (!isRecord(plugin) || !validatePluginDescriptor(plugin.descriptor)) {
    throw new PluginRegistrationError(
      "A plugin must provide a valid identifier, semantic version, role, capabilities, and requirements.",
    );
  }
  if (typeof plugin.contribute !== "function") {
    throw new PluginRegistrationError(
      `Plugin "${plugin.descriptor.id}" must implement contribute().`,
    );
  }
  if (
    plugin.descriptor.role === "framework" &&
    typeof plugin.createFrameworkContext !== "function"
  ) {
    throw new PluginRegistrationError(
      `Framework plugin "${plugin.descriptor.id}" must implement createFrameworkContext().`,
    );
  }
  if (
    plugin.descriptor.role === "architecture" &&
    typeof plugin.resolveArchitectureLayout !== "function"
  ) {
    throw new PluginRegistrationError(
      `Architecture plugin "${plugin.descriptor.id}" must implement resolveArchitectureLayout().`,
    );
  }
}

/** Registry populated by the host application; core does not hard-code plugin implementations. */
export class PluginRegistry {
  private readonly plugins = new Map<string, GeneratorPlugin>();

  register(plugin: GeneratorPlugin): void {
    validatePlugin(plugin);
    if (this.plugins.has(plugin.descriptor.id)) {
      throw new PluginRegistrationError(`Plugin "${plugin.descriptor.id}" is already registered.`);
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
    });
    this.plugins.set(plugin.descriptor.id, { ...plugin, descriptor });
  }

  get(pluginId: string): GeneratorPlugin | undefined {
    return this.plugins.get(pluginId);
  }

  list(): PluginDescriptor[] {
    return [...this.plugins.values()]
      .map(({ descriptor }) => descriptor)
      .sort((left, right) => left.id.localeCompare(right.id));
  }
}
