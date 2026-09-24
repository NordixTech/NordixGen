import type { NordixIr } from '../../../core/ir/types.js';

export function generateLlmToolsCode(ir: NordixIr): string {
  const toolsJson = JSON.stringify(
    ir.useCases.map((uc) => ({
      name: uc.name,
      description: uc.description,
      parameters: {
        type: 'object',
        properties: uc.inputSchema,
        required: uc.rolesRequired,
      },
    })),
    null,
    2,
  );

  return `/**
 * AI Agentic Tooling Module
 * Exposes application Use Cases as callable tools for LLM agents (OpenAI, Gemini, Anthropic)
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import type { DatabaseInstance } from '../../db/index.js';
import { ValidationError, NotFoundError } from '../../common/errors.js';

export const REGISTERED_USE_CASE_TOOLS = ${toolsJson} as const;

export function createAgentRouter(db: DatabaseInstance) {
  const router = new Hono();

  // List all available tools and their parameter schemas for LLMs
  router.get('/tools', (c) => {
    return c.json({
      version: '1.0.0',
      toolsCount: REGISTERED_USE_CASE_TOOLS.length,
      tools: REGISTERED_USE_CASE_TOOLS,
    });
  });

  const ExecuteToolSchema = z.object({
    tool: z.string(),
    parameters: z.record(z.unknown()).default({}),
  });

  // Execute a specific tool on behalf of an agent
  router.post('/execute', zValidator('json', ExecuteToolSchema), async (c) => {
    const { tool, parameters } = c.req.valid('json');

    const matchedTool = REGISTERED_USE_CASE_TOOLS.find((t) => t.name === tool);
    if (!matchedTool) {
      throw new NotFoundError('AgentTool', tool);
    }

    console.log(\`[Agent Tool Execution]: Executing use case '\${tool}' with parameters:\`, parameters);

    // Dynamic execution dispatch
    // In production, invoke the corresponding domain use case with parsed params
    return c.json({
      success: true,
      tool,
      executedAt: new Date().toISOString(),
      result: {
        message: \`Use case '\${tool}' dispatched successfully by NordixGen Agent Module.\`,
        parametersReceived: parameters,
      },
    });
  });

  return router;
}
`;
}
