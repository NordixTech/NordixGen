import { zodToJsonSchema } from "zod-to-json-schema";
import { NordixConfigSchema } from "./configuration/schema.js";

export function createNordixJsonSchema(): Record<string, unknown> {
  const generated = zodToJsonSchema(NordixConfigSchema, {
    name: "NordixConfig",
    target: "jsonSchema7",
    $refStrategy: "none",
  }) as { definitions?: Record<string, Record<string, unknown>> };
  return {
    $schema: "http://json-schema.org/draft-07/schema#",
    title: "NordixGen Configuration",
    ...generated.definitions?.NordixConfig,
  };
}
