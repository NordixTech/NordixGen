import * as anthropic from "@ai-sdk/anthropic";
import * as google from "@ai-sdk/google";
import * as groq from "@ai-sdk/groq";
import * as openai from "@ai-sdk/openai";
import * as apiKeys from "@better-auth/api-key";
import * as oauth from "@better-auth/oauth-provider";
import * as mcpServer from "@modelcontextprotocol/sdk/server/index.js";
import * as mcpHttp from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import * as mcpTypes from "@modelcontextprotocol/sdk/types.js";
import * as ai from "ai";
import * as bodyLimit from "hono/body-limit";
import * as jsonSchema from "zod-to-json-schema";
import * as zod4 from "zod/v4";
export const aiDependencies = {
  "zod/v4": zod4,
  "zod-to-json-schema": jsonSchema,
  "@better-auth/api-key": apiKeys,
  "@better-auth/oauth-provider": oauth,
  "hono/body-limit": bodyLimit,
  ai,
  "@ai-sdk/openai": openai,
  "@ai-sdk/anthropic": anthropic,
  "@ai-sdk/google": google,
  "@ai-sdk/groq": groq,
  "@modelcontextprotocol/sdk/server/index.js": mcpServer,
  "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js": mcpHttp,
  "@modelcontextprotocol/sdk/types.js": mcpTypes,
};
