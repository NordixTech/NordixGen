import type { UIMessage } from "ai";
import { chatHistorySource } from "../src/generation/ai-history.js";
import { generatedRuntime } from "./generated-runtime.js";

const load = generatedRuntime(
  { "ai/history.ts": chatHistorySource },
  {
    "drizzle-orm": {},
    "database/drizzle-database.ts": {},
    "database/schema/chat-schema.ts": {},
    "ai/registry.ts": {
      ToolFailure: class extends Error {
        constructor(
          readonly status: number,
          message: string,
        ) {
          super(message);
        }
      },
    },
  },
);
export const reconcileHistory = load("ai/history.ts").reconcileHistory as (
  stored: UIMessage[],
  incoming: UIMessage[],
) => UIMessage[];
