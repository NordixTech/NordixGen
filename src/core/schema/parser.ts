import { parse as parseYaml } from 'yaml';
import { ZodError } from 'zod';
import { type NordixConfig, NordixConfigSchema } from './nordix.schema.js';

export interface ParseResult {
  success: boolean;
  data?: NordixConfig;
  errors?: string[];
}

export function parseNordixConfig(yamlContent: string): ParseResult {
  try {
    const rawParsed = parseYaml(yamlContent);
    if (!rawParsed || typeof rawParsed !== 'object' || Array.isArray(rawParsed)) {
      return {
        success: false,
        errors: ['Invalid YAML: root content must be an object'],
      };
    }

    const validated = NordixConfigSchema.parse(rawParsed);
    return {
      success: true,
      data: validated,
    };
  } catch (error) {
    if (error instanceof ZodError) {
      const formattedErrors = error.errors.map((err) => {
        const path = err.path.join('.');
        return `${path ? `[${path}] ` : ''}${err.message}`;
      });
      return {
        success: false,
        errors: formattedErrors,
      };
    }

    if (error instanceof Error) {
      return {
        success: false,
        errors: [error.message],
      };
    }

    return {
      success: false,
      errors: ['Unknown parsing error occurred'],
    };
  }
}
