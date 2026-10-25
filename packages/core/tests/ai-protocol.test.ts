import { createHash, randomBytes } from "node:crypto";
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
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import * as authApi from "better-auth/api";
import * as hono from "hono";
import * as bodyLimit from "hono/body-limit";
import { describe, expect, it, vi } from "vitest";
import * as zod from "zod";
import * as zod4 from "zod/v4";
import { generateBackend } from "../src/generation/backend.js";
import { reconcileHistory } from "./ai-history-runtime.js";
import { resolvedFixture, targetConfig } from "./fixtures.js";
import { generatedRuntime } from "./generated-runtime.js";

function setup(model?: ai.LanguageModel) {
  const config = targetConfig("single-module");
  Object.assign(config.backends[0], {
    authentication: {},
    authorization: {
      roles: ["admin", "member"],
      adminRole: "admin",
      defaultRole: "member",
      rolePermissions: { member: ["notes:read"] },
    },
    ai: { enabled: true, mcp: { enabled: true, authMethods: ["oauth", "api-key"] } },
  });
  config.endpoints[0].permissions = ["notes:read"];
  config.endpoints.push({
    ...config.endpoints[0],
    operationId: "createNote",
    method: "POST",
    permissions: ["notes:write"],
    queryParams: [],
    pagination: undefined,
    requestBody: { useCase: { entity: "Note", operation: "create" } },
  });
  const result = generateBackend(resolvedFixture(config), "api");
  if (!result.success) throw Error("Generation failed");
  const files = result.virtualFileSystem.snapshot();
  let savedMessages: ai.UIMessage[] = [];
  const env = {
    DATABASE_URL: "memory",
    BETTER_AUTH_URL: "https://mcp.test",
    MCP_PUBLIC_URL: "https://mcp.test",
    BETTER_AUTH_SECRET: "test-only-secret-with-at-least-32-characters",
  };
  let grants = ["notes:read", "notes:write"];
  const execute = vi.fn(async () => ({
    ok: true,
    value: [{ entity: { title: "test" }, joins: {} }],
  }));
  const database: Record<string, Record<string, unknown>[]> = Object.fromEntries(
    [
      "user",
      "account",
      "session",
      "verification",
      ...Object.keys(apiKeys.apiKey().schema),
      ...Object.keys(
        oauth.oauthProvider({ loginPage: "/sign-in", consentPage: "/consent" }).schema,
      ),
    ].map((name) => [name, []]),
  );
  const load = generatedRuntime(files, {
    "apps/api/src/platform/ai/history.ts": {
      reconcileHistory: (stored: ai.UIMessage[], incoming: ai.UIMessage[]) => {
        try {
          return reconcileHistory(stored, incoming);
        } catch (error) {
          throw new (
            load("apps/api/src/platform/ai/registry.ts").ToolFailure as new (
              status: number,
              message: string,
            ) => Error
          )(400, (error as Error).message);
        }
      },
      createChatStore: () => ({
        acquire: async () => "test-lease",
        load: async () => ({ messages: structuredClone(savedMessages) }),
        save: async (_id: string, _owner: string, _token: string, messages: ai.UIMessage[]) => {
          savedMessages = JSON.parse(JSON.stringify(messages));
        },
        release: async () => {},
        action: async (
          _id: string,
          _owner: string,
          _token: string,
          _call: string,
          execute: () => Promise<unknown>,
        ) => execute(),
      }),
    },
    ...(model ? { "apps/api/src/platform/ai/model.ts": { selectModel: () => model } } : {}),
    zod,
    "zod/v4": zod4,
    "better-auth/api": authApi,
    "@better-auth/api-key": apiKeys,
    "@better-auth/oauth-provider": oauth,
    hono,
    "hono/body-limit": bodyLimit,
    ai,
    "@ai-sdk/openai": openai,
    "@ai-sdk/anthropic": anthropic,
    "@ai-sdk/google": google,
    "@ai-sdk/groq": groq,
    "@modelcontextprotocol/sdk/server/index.js": mcpServer,
    "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js": mcpHttp,
    "@modelcontextprotocol/sdk/types.js": mcpTypes,
    "apps/api/src/platform/auth/auth.ts": {
      createAuth: (environment: typeof env) => auth(environment),
      isTrustedAuthOrigin: (origin: string) =>
        ["https://app.test", "https://mcp.test"].includes(origin),
    },
    "apps/api/src/platform/database/drizzle-database.ts": { createDrizzleDatabase: () => ({}) },
    "apps/api/src/platform/authorization/repository.ts": {
      createIamRepository: () => ({
        principal: async (id: string) =>
          database.user.some((user) => user.id === id)
            ? { id, role: "member", permissions: [...grants] }
            : undefined,
      }),
    },
    "apps/api/src/platform/database/create-route-dependencies.ts": {
      createRouteDependencies: () => ({
        modules: {
          notes: {
            operations: { listNotes: execute, createNote: execute },
            checkAccess: () => undefined,
          },
        },
      }),
    },
    "apps/api/src/platform/audit/store.ts": { createAuditWriter: () => async () => undefined },
  });
  const plugins = load("apps/api/src/platform/ai/auth.ts") as {
    mcpApiKeys: typeof apiKeys.apiKey;
    mcpOAuth: (env: unknown) => ReturnType<typeof oauth.oauthProvider>;
    mcpVerifier: (env: unknown) => {
      id: string;
      endpoints: { verifyMcpToken: ReturnType<typeof authApi.createAuthEndpoint> };
    };
  };
  function auth(environment = env) {
    return betterAuth({
      baseURL: environment.BETTER_AUTH_URL,
      secret: env.BETTER_AUTH_SECRET,
      database: memoryAdapter(database),
      emailAndPassword: { enabled: true },
      rateLimit: { enabled: false },
      plugins: [
        plugins.mcpApiKeys(),
        plugins.mcpOAuth(environment),
        plugins.mcpVerifier(environment),
      ],
    });
  }
  const app = new hono.Hono();
  app.route(
    "/",
    (
      load("apps/api/src/platform/ai/routes.ts") as { createAiRoutes: () => hono.Hono }
    ).createAiRoutes(),
  );
  app.all("/api/auth/*", (c) => auth().handler(c.req.raw));
  const gateway = load("apps/api/mcp-gateway/index.ts").default as {
    fetch: (request: Request, env: unknown) => Promise<Response>;
  };
  const context = { waitUntil: () => {}, passThroughOnException: () => {}, props: {} };
  const request = (path: string, init?: RequestInit) =>
    gateway.fetch(new Request(`https://mcp.test${path}`, init), {
      OAUTH_ENABLED: "1",
      BACKEND: { fetch: (request: Request) => app.fetch(request, env, context) },
    });
  async function user() {
    const response = await auth().api.signUpEmail({
      body: { email: "operator@example.test", name: "Operator", password: "A-test-password-123" },
      asResponse: true,
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    return {
      id: body.user.id as string,
      cookie: response.headers
        .getSetCookie()
        .map((cookie) => cookie.split(";")[0])
        .join("; "),
    };
  }
  async function call(
    token: string,
    method: string,
    params: unknown = {},
    header = "Authorization",
  ) {
    const response = await request("/mcp", {
      method: "POST",
      headers: {
        [header]: header === "Authorization" ? `Bearer ${token}` : token,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "MCP-Protocol-Version": "2025-11-25",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    const text = await response.text();
    const data =
      text
        .split("\n")
        .find((line) => line.startsWith("data: "))
        ?.slice(6) ?? text;
    return { status: response.status, body: data ? JSON.parse(data) : null };
  }
  return {
    env,
    request,
    call,
    user,
    auth,
    execute,
    setGrants: (value: string[]) => {
      grants = value;
    },
    app,
    context,
    load,
  };
}
describe("generated MCP over real HTTP transport and Better Auth", () => {
  it("rejects a provider callback that changes the client OAuth state", async () => {
    const server = setup();
    const gateway = server.load("apps/api/mcp-gateway/index.ts").default as {
      fetch: (request: Request, env: unknown) => Promise<Response>;
    };
    await expect(
      gateway.fetch(new Request("https://mcp.test/authorize?state=original"), {
        OAUTH_ENABLED: "1",
        BACKEND: {
          fetch: async () =>
            new Response(null, {
              status: 302,
              headers: { Location: "https://client.test/callback?code=test&state=different" },
            }),
        },
      }),
    ).rejects.toThrow("OAuth response state mismatch");
  });
  it("infers native Codex registrations while preserving web redirect validation", async () => {
    const server = setup();
    const register = (redirect: string, application_type?: string) =>
      server.request("/api/auth/oauth2/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_name: "Codex",
          redirect_uris: [redirect],
          token_endpoint_auth_method: "none",
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
          ...(application_type ? { application_type } : {}),
        }),
      });
    const native = await register("http://127.0.0.1:43123/callback/codex-test");
    expect(native.status, await native.clone().text()).toBe(201);
    expect(await native.json()).toMatchObject({ application_type: "native" });
    const web = await register("https://chatgpt.com/connector_platform_oauth_redirect");
    expect(web.status, await web.clone().text()).toBe(201);
    expect(await web.json()).toMatchObject({ application_type: "web" });
    expect((await register("http://attacker.test/callback")).status).toBe(400);
    expect((await register("http://127.0.0.1:43123/callback", "web")).status).toBe(400);
  });
  it("recovers a streamed invalid-tool error between three approvals without replaying writes", async () => {
    let phase = 0;
    const usage = {
      inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 1, text: 1, reasoning: 0 },
    };
    const model = new MockLanguageModelV3({
      doStream: async () => {
        const current = phase++;
        if (current === 1 || current === 3)
          return {
            stream: simulateReadableStream({
              chunks: [
                { type: "stream-start", warnings: [] },
                {
                  type: "error",
                  error: Object.assign(
                    new Error(
                      "Tool call validation failed: attempted to call tool createNote which was not in request.tools",
                    ),
                    { statusCode: 400 },
                  ),
                },
              ],
            }),
          };
        const index = current === 0 ? 1 : current === 2 ? 2 : 3;
        return {
          stream: simulateReadableStream({
            chunks:
              current < 5
                ? [
                    { type: "stream-start", warnings: [] },
                    {
                      type: "tool-call",
                      toolCallId: `call-${index}`,
                      toolName: "notes_createNote",
                      input: JSON.stringify({ title: `Meal ${index}` }),
                    },
                    {
                      type: "finish",
                      finishReason: { unified: "tool-calls", raw: "tool_calls" },
                      usage,
                    },
                  ]
                : [
                    { type: "stream-start", warnings: [] },
                    { type: "text-start", id: "text" },
                    { type: "text-delta", id: "text", delta: "Created three notes" },
                    { type: "text-end", id: "text" },
                    { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage },
                  ],
          }),
        };
      },
    });
    const server = setup(model);
    const user = await server.user();
    let messages: ai.UIMessage[] = [
      {
        id: "question",
        role: "user",
        parts: [{ type: "text", text: "Add 3 notes. Eat breakfast, lunch and dinner." }],
      },
    ];
    for (let approval = 0; approval <= 3; approval++) {
      const response = await server.app.request(
        "https://app.test/api/chat",
        {
          method: "POST",
          headers: {
            cookie: user.cookie,
            Origin: "https://app.test",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ id: "11111111-1111-4111-8111-111111111111", messages }),
        },
        server.env,
        server.context,
      );
      expect(response.status, await response.clone().text()).toBe(200);
      const chunks = (await response.text())
        .split("\n")
        .filter((line) => line.startsWith("data: ") && !line.includes("[DONE]"))
        .map((line) => JSON.parse(line.slice(6)));
      expect(chunks.some((chunk) => chunk.type === "error")).toBe(false);
      let assistant: ai.UIMessage | undefined;
      for await (const message of ai.readUIMessageStream({
        message: messages.at(-1)?.role === "assistant" ? messages.at(-1) : undefined,
        stream: new ReadableStream({
          start(controller) {
            for (const chunk of chunks) controller.enqueue(chunk);
            controller.close();
          },
        }),
      }))
        assistant = message;
      expect(server.execute).toHaveBeenCalledTimes(approval);
      if (!assistant) throw Error("Missing assistant response");
      messages =
        messages.at(-1)?.role === "assistant"
          ? [...messages.slice(0, -1), assistant]
          : [...messages, assistant];
      const pending = assistant.parts.find(
        (part) => "state" in part && part.state === "approval-requested",
      );
      if (approval < 3) {
        if (!pending || !("approval" in pending)) throw Error("Missing next approval");
        Object.assign(pending, {
          state: "approval-responded",
          approval: { ...pending.approval, approved: true },
        });
      } else expect(pending).toBeUndefined();
    }
    expect(server.execute).toHaveBeenCalledTimes(3);
  });
  it("uses the advertised issuer on success and error callbacks without buffering MCP", async () => {
    const server = setup();
    const gateway = server.load("apps/api/mcp-gateway/index.ts").default as {
      fetch(request: Request, env: unknown): Promise<Response>;
    };
    const issuer = "https://mcp.test";
    for (const result of [
      new Response(null, {
        status: 302,
        headers: {
          Location:
            "https://client.test/callback?code=code&state=state&iss=https%3A%2F%2Fwrong.test",
        },
      }),
      Response.json({
        redirect_uri:
          "https://client.test/callback?error=access_denied&state=state&iss=https%3A%2F%2Fwrong.test",
      }),
    ]) {
      const response = await gateway.fetch(
        new Request("https://mcp.test/api/auth/oauth2/consent", { method: "POST" }),
        {
          OAUTH_ENABLED: "1",
          BACKEND: { fetch: async () => result },
        },
      );
      const target = response.headers.get("location") ?? (await response.json()).redirect_uri;
      expect(new URL(target).searchParams.get("iss")).toBe(issuer);
      expect(new URL(target).searchParams.get("state")).toBe("state");
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
    const original = new Response("event: message\ndata: {}\n\n", {
      headers: { "Content-Type": "text/event-stream" },
    });
    expect(
      await gateway.fetch(new Request("https://mcp.test/mcp"), {
        OAUTH_ENABLED: "1",
        BACKEND: { fetch: async () => original },
      }),
    ).toBe(original);
  });
  it("requires a signed web-chat approval before executing a mutation", async () => {
    let step = 0;
    const model = new MockLanguageModelV3({
      doStream: async () => ({
        stream: simulateReadableStream({
          chunks:
            step++ === 0
              ? [
                  { type: "stream-start", warnings: [] },
                  {
                    type: "tool-call",
                    toolCallId: "call-1",
                    toolName: "notes_createNote",
                    input: JSON.stringify({ title: "Approved note" }),
                  },
                  {
                    type: "finish",
                    finishReason: { unified: "tool-calls", raw: "tool_calls" },
                    usage: {
                      inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
                      outputTokens: { total: 1, text: 1, reasoning: 0 },
                    },
                  },
                ]
              : [
                  { type: "stream-start", warnings: [] },
                  { type: "text-start", id: "text" },
                  { type: "text-delta", id: "text", delta: "Done" },
                  { type: "text-end", id: "text" },
                  {
                    type: "finish",
                    finishReason: { unified: "stop", raw: "stop" },
                    usage: {
                      inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
                      outputTokens: { total: 1, text: 1, reasoning: 0 },
                    },
                  },
                ],
        }),
      }),
    });
    const server = setup(model);
    const user = await server.user();
    const userMessage = {
      id: "question",
      role: "user",
      parts: [{ type: "text", text: "Create a note" }],
    };
    const chat = (messages: unknown[]) =>
      server.app.request(
        "https://app.test/api/chat",
        {
          method: "POST",
          headers: {
            cookie: user.cookie,
            Origin: "https://app.test",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ id: "11111111-1111-4111-8111-111111111111", messages }),
        },
        server.env,
        server.context,
      );
    const response = await chat([userMessage]);
    expect(response.status, await response.clone().text()).toBe(200);
    const chunks = (await response.text())
      .split("\n")
      .filter((line) => line.startsWith("data: ") && !line.includes("[DONE]"))
      .map((line) => JSON.parse(line.slice(6)));
    expect(chunks.some((chunk) => chunk.type === "tool-approval-request")).toBe(true);
    expect(server.execute).not.toHaveBeenCalled();
    let assistant: ai.UIMessage | undefined;
    for await (const message of ai.readUIMessageStream({
      stream: new ReadableStream({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(chunk);
          controller.close();
        },
      }),
    }))
      assistant = message;
    if (!assistant) throw Error("Missing assistant response");
    const tool = assistant.parts.find(
      (part) => "state" in part && part.state === "approval-requested",
    );
    if (!tool || !("approval" in tool) || !tool.approval) throw Error("Missing approval card");
    Object.assign(tool, {
      state: "approval-responded",
      approval: { ...tool.approval, approved: true },
    });
    const completed = await chat([userMessage, assistant]);
    expect(completed.status, await completed.clone().text()).toBe(200);
    await completed.text();
    expect(server.execute).toHaveBeenCalledTimes(1);
  });
  it("rejects missing credentials before token/database resolution and exposes OAuth discovery", async () => {
    const server = setup();
    expect((await server.request("/mcp")).status).toBe(401);
    expect(
      (await server.request("/mcp", { headers: { Authorization: "Bearer invalid" } })).status,
    ).toBe(401);
    const response = await server.request("/.well-known/oauth-protected-resource");
    expect(await response.json()).toMatchObject({
      resource: "https://mcp.test/mcp",
      authorization_servers: ["https://mcp.test"],
    });
    for (const path of [
      "/.well-known/oauth-authorization-server",
      "/.well-known/oauth-authorization-server/api/auth",
      "/api/auth/.well-known/oauth-authorization-server",
    ]) {
      const metadata = await server.request(path);
      expect(metadata.status).toBe(200);
      expect(await metadata.json()).toMatchObject({
        issuer: "https://mcp.test",
        authorization_endpoint: "https://mcp.test/api/auth/oauth2/authorize",
        token_endpoint: "https://mcp.test/api/auth/oauth2/token",
      });
    }
  });
  it("authenticates personal keys, intersects scopes with live IAM, executes tools and revokes access", async () => {
    const server = setup();
    const user = await server.user();
    const key = await server.auth().api.createApiKey({
      body: {
        name: "Test MCP",
        userId: user.id,
        permissions: { tools: ["notes:read", "notes:write"] },
      },
    });
    expect(key.key).toMatch(/^nordix_live_sk_/);
    const list = await server.call(key.key, "tools/list");
    expect(list.status).toBe(200);
    expect(list.body.result.tools).toHaveLength(2);
    const mutation = list.body.result.tools.find(
      (tool: { name: string }) => tool.name === "notes_createNote",
    );
    expect(mutation.annotations.destructiveHint).toBe(true);
    expect(mutation.inputSchema.required).toContain("confirm");
    const denied = await server.call(key.key, "tools/call", {
      name: "notes_createNote",
      arguments: { title: "test" },
    });
    expect(denied.body.result.isError).toBe(true);
    expect(server.execute).not.toHaveBeenCalled();
    const ok = await server.call(
      key.key,
      "tools/call",
      { name: "notes_createNote", arguments: { title: "test", confirm: true } },
      "x-api-key",
    );
    expect(ok.body.result.isError).not.toBe(true);
    expect(server.execute).toHaveBeenCalledTimes(1);
    server.setGrants(["notes:read"]);
    expect((await server.call(key.key, "tools/list")).body.result.tools).toHaveLength(1);
    expect(
      (
        await server.call(key.key, "tools/call", {
          name: "notes_createNote",
          arguments: { title: "test", confirm: true },
        })
      ).status,
    ).toBe(403);
    await server
      .auth()
      .api.deleteApiKey({ body: { keyId: key.id }, headers: new Headers({ cookie: user.cookie }) });
    expect((await server.call(key.key, "tools/list")).status).toBe(401);
  }, 20000);
  it("completes OAuth authorization-code/PKCE with issuer binding, enforces audience and revocation", async () => {
    const server = setup();
    const user = await server.user();
    const redirect = "http://127.0.0.1:43210/callback";
    const registered = await server.request("/api/auth/oauth2/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: "Test MCP",
        application_type: "native",
        redirect_uris: [redirect],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      }),
    });
    expect(registered.status, await registered.clone().text()).toBe(201);
    const client = await registered.json();
    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const oauthState = `state-+/%?&= 🧪 ${randomBytes(192).toString("base64url")}`;
    const query = new URLSearchParams({
      client_id: client.client_id,
      response_type: "code",
      redirect_uri: redirect,
      scope: "mcp:tools",
      resource: "https://mcp.test/mcp",
      code_challenge: challenge,
      code_challenge_method: "S256",
      state: oauthState,
    });
    const authorization = await server.request(`/authorize?${query}`, {
      headers: { cookie: user.cookie, Accept: "text/html" },
    });
    expect(authorization.status).toBe(302);
    const consentUrl = new URL(authorization.headers.get("location") ?? "https://invalid");
    expect(consentUrl.pathname).toBe("/consent");
    const consent = await server.request("/api/auth/oauth2/consent", {
      method: "POST",
      headers: {
        cookie: user.cookie,
        Origin: "https://mcp.test",
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ accept: true, oauth_query: consentUrl.search.slice(1) }),
    });
    expect(consent.status, await consent.clone().text()).toBe(200);
    const accepted = await consent.json();
    expect(new URL(accepted.redirect_uri ?? accepted.url).searchParams.get("state")).toBe(
      oauthState,
    );
    expect(new URL(accepted.redirect_uri ?? accepted.url).searchParams.get("iss")).toBe(
      "https://mcp.test",
    );
    const code = new URL(accepted.redirect_uri ?? accepted.url).searchParams.get("code");
    expect(code).toBeTruthy();
    const token = await server.request("/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: client.client_id,
        code: code ?? "",
        code_verifier: verifier,
        redirect_uri: redirect,
        resource: "https://mcp.test/mcp",
      }),
    });
    expect(token.status, await token.clone().text()).toBe(200);
    const issued = await token.json();
    expect((await server.call(issued.access_token, "tools/list")).status).toBe(200);
    const revoked = await server.request("/api/auth/oauth2/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        token: issued.access_token,
        client_id: client.client_id,
        token_type_hint: "access_token",
      }),
    });
    expect(revoked.status).toBe(200);
    expect((await server.call(issued.access_token, "tools/list")).status).toBe(401);
  }, 20000);
});
