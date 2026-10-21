# AI and MCP

Expose business operations to an authenticated chat assistant or external MCP clients. Both use the same tools and current backend permissions.

## Enable AI

Configure one persisted, authentication-enabled AI backend per project:

```yaml
ai:
  enabled: true
  mcp:
    enabled: true
    authMethods: [oauth, api-key]
  tools:
    requireConfirmationOnMutations: true
```

On a connected frontend, enable the surfaces you want:

```yaml
ai:
  enabled: true
  backend: api
  chat: { enabled: true, placement: floating }
  connectPortal: { enabled: true }
```

The AI backend must be in `connectsTo` and be the frontend's identity authority. Chat and portal default to disabled. Use `placement: page` for `/chat` instead of a floating assistant. `/chat` and `/connect-ai` require a verified session; the connection portal also requires backend MCP.

## Configure a provider

Set provider credentials as backend runtime secrets. Detection selects the first nonempty key:

1. `OPENAI_API_KEY`
2. `ANTHROPIC_API_KEY`
3. `GEMINI_API_KEY`
4. `GROQ_API_KEY`

Set `AI_MODEL` to override that provider's generated default. Check that the selected model is available in your provider account. Provider selection is not a YAML field, and keys must never enter the frontend bundle.

Without a provider key, chat returns a descriptive 400; MCP tools and the rest of the application remain usable. Generated `cicd:setup` accepts provider secrets. Docker uses backend-prefixed values such as `<BACKEND>_OPENAI_API_KEY`.

## Tools and approval

Declared business operations become tools named `<module>_<operationId>`, with module hyphens converted to underscores. Tool names are limited to 64 characters. Inputs preserve endpoint types, required fields and pagination. `confirm` is reserved. Health, authentication and IAM routes are not automatically business tools.

Discovery and execution check live database permissions. Personal API keys can further restrict access. Audit-enabled operations retain their capture.

Mutation confirmation defaults to enabled. Web chat shows signed approve/deny requests before execution. MCP requires `confirm: true` on destructive calls; the external client supplies the interactive approval. That boolean is a client declaration, not proof of a human click.

## Chat history

Conversations belong to the authenticated account and are stored in PostgreSQL. Apply migrations before use. The UI supports conversation selection/deletion, safe Markdown and expandable tool results.

A conversation is bounded to 100 messages and 2 MB. The browser cannot rewrite previous assistant/tool messages. Stored action records prevent replaying completed or uncertain mutations, while bounded stream recovery preserves earlier results. Design custom side effects with clear retry behavior.

## Connect an MCP client

Generation creates a separate public Worker at `<backend-path>/mcp-gateway`. It exposes MCP/OAuth routes and calls the private backend through a Service Binding.

Set `MCP_PUBLIC_URL` to the gateway origin, independently of frontend `BETTER_AUTH_URL`. Clients connect to `<gateway-origin>/mcp`. The generic frontend proxy rejects MCP; backend public/preview URLs remain disabled.

Choose either:

- **OAuth:** the external client initiates authorization and owns PKCE, state and callback verification. Discovery uses the gateway origin as issuer.
- **Personal key:** create a scoped key in `/connect-ai`, copy its secret once and send it as `x-api-key` or Bearer. The portal defaults to 30-day expiry and supports revocation. Keys are hashed and cannot exceed their owner's current grants.

The transport is stateless Streamable HTTP with SSE responses. Separate legacy HTTP+SSE endpoints are not implemented. API-only projects receive gateway login/consent screens without requiring a frontend.

For local Wrangler development, run backend and gateway configurations together. Docker exposes a gateway on loopback port 8790 by default. Override `MCP_<BACKEND>_PORT` and `<BACKEND>_MCP_PUBLIC_URL` together.

## Add custom tools

After generation, add an exported `*.tool.ts` file under backend `src/`. Import `defineTool` from generated `src/platform/ai/define-tool.ts` and export a variable initialized directly with:

```ts
// Shape of a tool definition; supply your schema and implementation.
defineTool({ name, description, permission, isDestructive, schema, execute });
```

Discovery runs before dev, typechecking and builds. Restart a running dev command after adding a file. Custom capabilities join the IAM catalog, but users still need their grants assigned.

Use `ctx.invoke(module, operation, input)` inside execution to call existing operations with trusted context. Validate new side effects and record ownership in your implementation; tool input must never establish actor, role or database authority.
