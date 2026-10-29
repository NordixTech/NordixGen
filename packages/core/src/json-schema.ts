import { z } from "zod";
import { NordixConfigSchema } from "./configuration/schema.js";

export function createNordixJsonSchema(): Record<string, unknown> {
  return {
    ...z.toJSONSchema(NordixConfigSchema, {
      target: "draft-7",
      io: "input",
      unrepresentable: "any",
    }),
    title: "NordixGen Configuration",
  };
}
