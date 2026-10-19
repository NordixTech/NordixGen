import { LineCounter, isNode, isScalar, parseDocument, stringify, visit } from "yaml";
import type { z } from "zod";
import { type ConfigDiagnostic, createDiagnostic } from "../diagnostics.js";
import { isolateConfigurationDictionaries } from "./dictionaries.js";
import { type NordixConfig, NordixConfigSchema } from "./schema.js";
import { THEME_MAIN_COLORS } from "./theme.js";
import { validateAccess } from "./validation/access.js";
import { validateApplications } from "./validation/applications.js";
import { validateEndpoints } from "./validation/endpoints.js";
import { validateEntities } from "./validation/entities.js";
import { validateModules } from "./validation/modules.js";
import { validatePersistence } from "./validation/persistence.js";

export type ConfigValidationResult =
  | {
      success: true;
      config: NordixConfig;
      locate?: (path: string) => ConfigDiagnostic["source"];
      diagnostics: ConfigDiagnostic[];
    }
  | { success: false; diagnostics: ConfigDiagnostic[] };
export const configurationPath = (segments: readonly (string | number)[]) =>
  segments.reduce<string>(
    (path, segment) =>
      typeof segment === "number" ? `${path}[${segment}]` : path ? `${path}.${segment}` : segment,
    "",
  );
function removed(path: string): string | undefined {
  if (/^(frontend|backend|docker|llm|deployment)$/.test(path))
    return "Use canonical plural application declarations; dormant deployment/Docker/AI options are outside YAML v2.";
  if (/^frontends\[\d+\]\.(framework|type|styling|ui|stateManagement|authUI)$/.test(path))
    return "Next.js, Tailwind, TanStack Query and Zustand are fixed. Remove this selector; use access for page/session requirements.";
  if (/^backends\[\d+\]\.(framework|architecture|auth)$/.test(path))
    return "Hono is fixed. Declare architecture under each module and use authentication for Better Auth settings; remove this legacy field.";
  if (
    /^(backends\[\d+\]\.(?:persistence\.orm|authentication\.plugin|authorization\.plugin)|databases\.[^.]+\.(?:engine|provider)|organizations\[\d+\]\.provider)$/.test(
      path,
    )
  )
    return "The implementation technology is fixed by NordixGen. Remove this selector and retain only project-specific settings.";
  return undefined;
}
function structuralDiagnostics(error: z.ZodError): ConfigDiagnostic[] {
  return error.issues.flatMap((issue) => {
    const path = configurationPath(issue.path);
    if (
      issue.code === "unrecognized_keys" &&
      /^frontends\[\d+\]\.theme\.(light|dark)$/.test(path) &&
      issue.keys.some((key) => (THEME_MAIN_COLORS as readonly string[]).includes(key))
    )
      return [
        createDiagnostic(
          "CONFIG_FIELD_INVALID",
          path,
          "Declare all seven main palette colors (primary, secondary, background, surface, foreground, muted, border), or omit them all. Status colors are individually optional.",
        ),
      ];
    if (issue.code === "unrecognized_keys")
      return issue.keys.map((key) => {
        const at = configurationPath([...issue.path, key]);
        const explanation = removed(at);
        return createDiagnostic(
          explanation ? "CONFIG_FIELD_REMOVED" : "CONFIG_FIELD_UNKNOWN",
          at,
          explanation ??
            `Unknown field "${key}". Remove it or use a field documented in the YAML v2 reference.`,
        );
      });
    if (path === "schemaVersion")
      return [
        createDiagnostic(
          "CONFIG_VERSION_UNSUPPORTED",
          path,
          "Declare schemaVersion: 2 (an integer), separate from the project's version. Previous schemas and aliases are not accepted.",
        ),
      ];
    if (issue.code === "invalid_enum_value" || issue.code === "invalid_union_discriminator")
      return [
        createDiagnostic(
          path.endsWith(".architecture")
            ? "MODULE_ARCHITECTURE_INVALID"
            : "CONFIG_VALUE_UNSUPPORTED",
          path,
          `Select one of the supported values: ${issue.options.map(String).join(", ")}. Correct this declaration.`,
        ),
      ];
    if (issue.code === "invalid_union")
      return [
        createDiagnostic(
          "CONFIG_FIELD_INVALID",
          path,
          /^frontends\[\d+\]\.theme\.(light|dark)$/.test(path)
            ? "Declare all seven main palette colors (primary, secondary, background, surface, foreground, muted, border), or omit them all. Status colors are individually optional. Use only documented palette fields and literal colors."
            : path.endsWith(".softDelete")
              ? "Use false to disable soft deletion, or select boolean or timestamp. Correct this softDelete declaration."
              : "Use the documented field definition/reference, or the strict requestBody useCase entity/create-or-update form. Do not mix forms or add unknown properties.",
        ),
      ];
    if (issue.code === "invalid_type")
      return [
        createDiagnostic(
          issue.received === "undefined" ? "CONFIG_FIELD_REQUIRED" : "CONFIG_FIELD_TYPE_INVALID",
          path,
          `Expected ${issue.expected}. Supply the required value at this configuration path using the documented v2 type.`,
        ),
      ];
    if (issue.code === "invalid_literal")
      return [
        createDiagnostic(
          "CONFIG_VALUE_UNSUPPORTED",
          path,
          `Use the required literal ${String(issue.expected)} at this configuration path.`,
        ),
      ];
    return [
      createDiagnostic(
        "CONFIG_FIELD_INVALID",
        path,
        issue.code === "custom"
          ? issue.message
          : issue.code === "invalid_string"
            ? path.includes(".theme.")
              ? issue.message
              : "Use the documented identifier, version or path format; names start with a letter and use their permitted characters."
            : issue.code === "too_small"
              ? "Supply a nonempty value/list or a number meeting the documented minimum."
              : "Correct the value to satisfy the documented limits and type.",
      ),
    ];
  });
}
function dataProblem(value: unknown): ConfigDiagnostic | undefined {
  const ancestors = new Set<object>();
  let count = 0;
  const walk = (
    current: unknown,
    path: (string | number)[],
    depth: number,
  ): ConfigDiagnostic | undefined => {
    if (depth > 80 || ++count > 100000)
      return createDiagnostic(
        "CONFIG_DATA_LIMIT",
        configurationPath(path),
        "Configuration nesting/size exceeds supported limits. Simplify this declaration.",
      );
    if (current === null || typeof current !== "object") return undefined;
    if (ancestors.has(current))
      return createDiagnostic(
        "CONFIG_DATA_CYCLE",
        configurationPath(path),
        "Cyclic configuration data/aliases are unsupported. Replace the cycle with ordinary acyclic values.",
      );
    ancestors.add(current);
    for (const [key, child] of Object.entries(current)) {
      const problem = walk(child, [...path, Array.isArray(current) ? Number(key) : key], depth + 1);
      if (problem) return problem;
    }
    ancestors.delete(current);
    return undefined;
  };
  return walk(value, [], 0);
}
function ordered(diagnostics: ConfigDiagnostic[]): ConfigDiagnostic[] {
  return diagnostics.sort(
    (a, b) =>
      a.path.localeCompare(b.path) ||
      a.code.localeCompare(b.code) ||
      a.message.localeCompare(b.message),
  );
}
export function validateNordixConfig(input: unknown): ConfigValidationResult {
  const problem = dataProblem(input);
  if (problem) return { success: false, diagnostics: [problem] };
  const parsed = NordixConfigSchema.safeParse(input);
  if (!parsed.success)
    return { success: false, diagnostics: ordered(structuralDiagnostics(parsed.error)) };
  const config = isolateConfigurationDictionaries(parsed.data);
  const diagnostics = ordered([
    ...validateApplications(config),
    ...validateModules(config),
    ...validateEntities(config),
    ...validateEndpoints(config),
    ...validatePersistence(config),
    ...validateAccess(config),
    ...(config.iac?.repository &&
    !config.repositories.some((repo) => repo.name === config.iac?.repository)
      ? [
          createDiagnostic(
            "CONFIG_FIELD_INVALID",
            "iac.repository",
            "Select a declared repository to own the project infrastructure.",
          ),
        ]
      : []),
    ...config.backends.flatMap((backend, index) =>
      (backend.iac?.r2_storage ?? []).flatMap((key) =>
        Object.hasOwn(config.iac?.cloudflare.r2_storage ?? {}, key)
          ? []
          : [
              createDiagnostic(
                "CONFIG_FIELD_INVALID",
                `backends[${index}].iac.r2_storage`,
                `Unknown R2 storage "${key}". Declare it under iac.cloudflare.r2_storage.`,
              ),
            ],
      ),
    ),
    ...Object.keys(config.iac?.cloudflare.r2_storage ?? {}).flatMap((key, index, keys) =>
      keys.findIndex((other) => other.toUpperCase() === key.toUpperCase()) === index
        ? []
        : [
            createDiagnostic(
              "CONFIG_FIELD_INVALID",
              `iac.cloudflare.r2_storage.${key}`,
              "R2 keys must have distinct uppercase binding names.",
            ),
          ],
    ),
    ...Object.keys(config.iac?.cloudflare.r2_storage ?? {}).flatMap((key) =>
      /^(DATABASE_URL|BETTER_AUTH_.*|AUTH_.*|CORS_.*|R2_.*|NODE_ENV|PORT|RESEND_API_KEY|GOOGLE_CLIENT_.*|GITHUB_CLIENT_.*)$/.test(
        key.toUpperCase(),
      )
        ? [
            createDiagnostic(
              "CONFIG_FIELD_INVALID",
              `iac.cloudflare.r2_storage.${key}`,
              "Choose an R2 key that does not collide with a reserved runtime environment variable.",
            ),
          ]
        : [],
    ),
  ]);
  if (diagnostics.some((d) => d.severity === "error")) return { success: false, diagnostics };
  return {
    success: true,
    config,
    diagnostics,
  };
}
export function parseNordixYaml(source: string, file?: string): ConfigValidationResult {
  const lineCounter = new LineCounter();
  const document = parseDocument(source, { uniqueKeys: true, lineCounter });
  const locate = (diagnostic: ConfigDiagnostic, offset: number): ConfigDiagnostic => ({
    ...diagnostic,
    source: {
      ...(file ? { file } : {}),
      line: lineCounter.linePos(offset).line,
      column: lineCounter.linePos(offset).col,
    },
  });
  if (document.errors.length)
    return {
      success: false,
      diagnostics: document.errors.map((error) =>
        locate(
          createDiagnostic(
            "YAML_SYNTAX_ERROR",
            "",
            `Malformed YAML (${error.code}). Correct the syntax or duplicate mapping key at this location.`,
          ),
          error.pos[0],
        ),
      ),
    };
  const yamlDiagnostics: ConfigDiagnostic[] = [];
  visit(document, {
    Pair(_key, pair) {
      if (!isScalar(pair.key) || typeof pair.key.value !== "string")
        yamlDiagnostics.push(
          locate(
            createDiagnostic(
              "YAML_MAPPING_KEY_INVALID",
              "",
              "Configuration mappings require unique string keys. Replace this key with an identifier.",
            ),
            isNode(pair.key) ? (pair.key.range?.[0] ?? 0) : 0,
          ),
        );
      else if (pair.key.value === "<<")
        yamlDiagnostics.push(
          locate(
            createDiagnostic(
              "YAML_MERGE_UNSUPPORTED",
              "",
              "YAML merge keys are unsupported. Declare the properties explicitly or use a plain acyclic alias.",
            ),
            pair.key.range?.[0] ?? 0,
          ),
        );
    },
    Node(_key, node) {
      if (
        "tag" in node &&
        node.tag &&
        !["str", "int", "float", "bool", "null", "map", "seq"].some(
          (tag) => node.tag === `tag:yaml.org,2002:${tag}`,
        )
      )
        yamlDiagnostics.push(
          locate(
            createDiagnostic(
              "YAML_TAG_UNSUPPORTED",
              "",
              "Custom/unsupported YAML tags are not configuration values. Use ordinary strings, numbers, booleans, lists and mappings.",
            ),
            node.range?.[0] ?? 0,
          ),
        );
    },
  });
  if (yamlDiagnostics.length) return { success: false, diagnostics: yamlDiagnostics };
  let input: unknown;
  try {
    input = document.toJS({ maxAliasCount: 100 });
  } catch {
    return {
      success: false,
      diagnostics: [
        locate(
          createDiagnostic(
            "YAML_CONVERSION_ERROR",
            "",
            "YAML cannot be converted safely. Remove excessive/cyclic aliases and use ordinary configuration data.",
          ),
          0,
        ),
      ],
    };
  }
  const result = validateNordixConfig(input);
  const locatePath = (path: string): ConfigDiagnostic["source"] => {
    const keys = (path.match(/[^.\[\]]+/g) ?? []).map((key) =>
      /^\d+$/.test(key) ? Number(key) : key,
    );
    let node: unknown;
    while (keys.length) {
      node = document.getIn(keys, true);
      if (isNode(node) && node.range) break;
      keys.pop();
    }
    const offset = isNode(node) ? (node.range?.[0] ?? 0) : 0;
    return {
      ...(file ? { file } : {}),
      line: lineCounter.linePos(offset).line,
      column: lineCounter.linePos(offset).col,
    };
  };
  const diagnostics = result.diagnostics.map((diagnostic) => ({
    ...diagnostic,
    source: locatePath(diagnostic.path),
  }));
  return result.success
    ? { ...result, diagnostics, locate: locatePath }
    : { ...result, diagnostics };
}

export function stringifyNordixYaml(input: unknown): string {
  const result = validateNordixConfig(input);
  if (!result.success)
    throw new Error(
      result.diagnostics.map((d) => `${d.code} at ${d.path}: ${d.message}`).join("\n"),
    );
  return stringify(input);
}
