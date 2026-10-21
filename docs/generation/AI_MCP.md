# AI chat, shared tools and external MCP clients

AI is optional. Configure one authentication-enabled, persisted backend per project. Chat, the frontend connection portal and MCP are separate switches. The [YAML reference](../configuration/YAML_V2.md#ai-chat-tools-and-mcp) contains the complete contract and protocol details.

## Enable the desired surfaces

Add these fragments to otherwise complete backend/frontend declarations before generation:

```yaml
# On the selected backend:
ai:
  enabled: true
  mcp:
    enabled: true
    authMethods: [oauth, api-key]
  tools:
    requireConfirmationOnMutations: true
```

```yaml
# On a frontend connected to that backend:
ai:
  enabled: true
  backend: api
  chat: { enabled: true, placement: floating }
  connectPortal: { enabled: true }
```

The AI backend must be in frontend `connectsTo` and be its session authority. Chat can be floating or a `/chat` page. The portal is `/connect-ai` and requires backend MCP. These pages require a verified session. An API-only backend can expose MCP through its own gateway and Hono-hosted login/consent screens without a frontend portal.

## Configure chat at runtime

Set backend-only provider credentials. Detection chooses the first nonempty credential in this order: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY`. `AI_MODEL` optionally overrides that provider's generated default. No provider selector belongs in YAML. These are implementation choices, not recommendations about current provider availability; verify the model with the provider before deployment and use an available override when necessary.

Without a provider credential, authenticated chat requests fail with a descriptive 400; non-chat application functions and MCP tools remain usable. Keep credentials out of browser bundles. Generated `cicd:setup` can collect provider secrets; local Docker uses the backend-prefixed environment values described in the [CLI workflow](CLI_WORKFLOW.md#native-cloudflare-cicd-and-neon).

Chat history lives in PostgreSQL and belongs to the signed-in account. Apply migrations before using it. Conversations support selection/deletion, safe Markdown and expandable tool results, and are bounded to 100 messages and 2 MB. The server owns assistant/tool history; clients cannot rewrite past tool results. Mutation action records prevent replay of completed or uncertain writes. Provider stream recovery preserves earlier results and reports exhausted failures; it is not a guarantee that every arbitrary custom side effect can be retried safely.

## Connect an external MCP client

Generation emits a separate public Worker under `<backend-path>/mcp-gateway`. It exposes MCP/OAuth entry points and calls the private Hono backend through a Service Binding. Set `MCP_PUBLIC_URL` to that gateway's origin, independently of frontend `BETTER_AUTH_URL`. The external client connects to the gateway's `/mcp`, not the generic Next.js backend proxy. Keep backend public/preview URLs disabled.

Use the generated connection portal for URL, key and onboarding instructions. An OAuth client initiates authorization itself and owns PKCE/state/callback verification. Alternatively create a scoped personal key: the portal displays the secret once, defaults to 30-day expiry and supports revocation. Clients send it as `x-api-key` or Bearer. A key's permissions further restrict the owner's live database grants; a key never grants more authority than its owner. Store it as a secret in the client.

The transport is stateless Streamable HTTP with SSE responses and negotiated SDK protocol versions. Separate legacy HTTP+SSE endpoints are not implemented. For local Wrangler development, run backend and gateway configurations together so the binding resolves. Docker supplies a lightweight gateway, normally port 8790; change `MCP_<BACKEND>_PORT` and matching `<BACKEND>_MCP_PUBLIC_URL` together when overriding it.

## Tool permissions and mutation approval

Declared business endpoints become tools named `<module>_<operationId>` with resolved path/query/body/pagination inputs. Health, authentication and IAM administration routes are not automatically business tools. Discovery and every execution check current database permissions; audit-enabled operations retain capture. Grant only the capabilities needed for a user's task.

Mutation confirmation defaults to enabled. Web chat displays signed approve/deny requests before execution. MCP requires `confirm: true` on destructive tools, but the external client owns the interactive approval. That boolean alone is not evidence of a human click. Preserve server authorization even when approval is present.

## Add custom tools after generation

Add exported `*.tool.ts` files under backend `src/`. Import `defineTool` from generated `src/platform/ai/define-tool.ts` using the relative path appropriate to the file, then export a variable initialized directly with `defineTool({ name, description, permission, isDestructive, schema, execute })`.

Discovery runs before development, typechecking and builds; restart a running dev command after adding a tool file. Both chat and MCP consume the same tool catalog. Custom permissions join the IAM catalog, but ordinary users still need grants assigned through IAM. Use `ctx.invoke(module, operation, input)` to reuse existing application operations with their trusted context and checks. Never take database credentials, role claims or an authoritative actor from tool input. Author appropriate validation, object-ownership checks and failure handling for new side effects, then test both allowed and denied execution.
