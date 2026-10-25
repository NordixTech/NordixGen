import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import * as zod from "zod";
import { validateNordixConfig } from "../src/configuration/validate.js";
import { generateBackend } from "../src/generation/backend.js";
import { generateFrontend } from "../src/generation/frontend.js";
import { resolveProject } from "../src/project/resolve.js";
import { resolvedFixture, targetConfig } from "./fixtures.js";
import { generatedRuntime } from "./generated-runtime.js";
import { generatedTypeErrors } from "./generated-types.js";

function aiFixture() {
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
    path: "/api/notes",
    permissions: ["notes:write"],
    queryParams: [],
    pagination: undefined,
    requestBody: { useCase: { entity: "Note", operation: "create" } },
    audit: true,
  });
  config.frontends.push({
    name: "web",
    repository: "app",
    path: "apps/web",
    connectsTo: ["api"],
    access: { mode: "public" },
    ai: {
      enabled: true,
      backend: "api",
      chat: { enabled: true, placement: "floating" },
      connectPortal: { enabled: true },
    },
  } as never);
  return config;
}
function backendFiles(config: unknown = aiFixture()) {
  const result = generateBackend(resolvedFixture(config), "api");
  if (!result.success) throw Error(JSON.stringify(result.diagnostics));
  return result.virtualFileSystem.snapshot();
}
describe("AI configuration and generated application contracts", () => {
  it("resolves strict AI switches and protects AI pages independently of public business pages", () => {
    const project = resolvedFixture(aiFixture());
    expect(project.backends.api.ai?.tools.requireConfirmationOnMutations).toBe(true);
    expect(
      project.frontends.web.pages.find((page) => page.path === "/connect-ai")?.authenticated,
    ).toBe(true);
    const backend = backendFiles();
    expect(JSON.parse(backend["apps/api/wrangler.jsonc"]).workers_dev).toBe(false);
    const gateway = JSON.parse(backend["apps/api/mcp-gateway/wrangler.jsonc"]);
    expect(gateway.workers_dev).toBe(true);
    expect(gateway.env.production.services[0].service).toBe("notes-project-api-production");
    const frontend = generateFrontend(project, "web").virtualFileSystem.snapshot();
    expect(frontend["apps/web/src/app/layout.tsx"]).toContain("<FloatingAssistant/>");
    expect(frontend["apps/web/src/app/connect-ai/page.tsx"]).toContain(
      'requirePageSession("/connect-ai")',
    );
    expect(frontend["apps/web/src/app/api/chat/route.ts"]).toContain('"/api/chat"');
    expect(Object.keys(frontend).some((path) => path.includes("/mcp"))).toBe(false);
  });
  it("rejects disabled, disconnected and conflicting AI references before generation", () => {
    const config = aiFixture();
    const diagnose = (value: unknown) => {
      const result = resolveProject(value);
      expect(result.success).toBe(false);
      return result.diagnostics.map((d) => d.code);
    };
    expect(
      diagnose({ ...config, backends: config.backends.map((b) => ({ ...b, ai: undefined })) }),
    ).toContain("AI_BACKEND_NOT_ENABLED");
    expect(
      diagnose({ ...config, frontends: config.frontends.map((f) => ({ ...f, connectsTo: [] })) }),
    ).toContain("AI_BACKEND_NOT_CONNECTED");
    expect(
      diagnose({
        ...config,
        backends: config.backends.map((b) => ({ ...b, authentication: undefined })),
      }),
    ).toContain("AI_IDENTITY_REQUIRED");
    expect(
      diagnose({
        ...config,
        backends: config.backends.map((b) => ({
          ...b,
          ai: { enabled: true, mcp: { enabled: false } },
        })),
      }),
    ).toContain("AI_MCP_NOT_ENABLED");
    expect(
      diagnose({ ...config, endpoints: [{ ...config.endpoints[0], path: "/mcp" }] }),
    ).toContain("AI_ROUTE_COLLISION");
    expect(
      diagnose({
        ...config,
        endpoints: [
          { ...config.endpoints[0], queryParams: [{ name: "confirm", type: "boolean" }] },
        ],
      }),
    ).toContain("AI_INPUT_COLLISION");
    expect(
      validateNordixConfig({
        ...config,
        backends: config.backends.map((b) => ({ ...b, ai: { enabled: true, provider: "openai" } })),
      }).success,
    ).toBe(false);
  });
  it("compiles generated backend against the real AI SDK, MCP SDK and Better Auth plugins", async () => {
    const files = Object.fromEntries(
      Object.entries(backendFiles())
        .filter(([name]) => name.endsWith(".ts") && !name.includes("mcp-gateway"))
        .map(([name, content]) => [name.replace("apps/api/", ""), content]),
    );
    expect(await generatedTypeErrors(files)).toEqual([]);
  }, 60000);
  it("compiles the generated chat and portal against real React and AI SDK types", async () => {
    const frontend = generateFrontend(
      resolvedFixture(aiFixture()),
      "web",
    ).virtualFileSystem.snapshot();
    const files = Object.fromEntries(
      Object.entries(frontend)
        .filter(([name]) => name.includes("/components/ai/") && name.endsWith(".tsx"))
        .map(([name, content]) => [name.replace("apps/web/src/", ""), content]),
    );
    expect(
      await generatedTypeErrors(
        files,
        { module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler },
        {
          "lib/auth/use-session-view.ts":
            "export function useSessionView():{user:{id:string}|null;isPending:boolean}{return {user:null,isPending:false};}",
        },
      ),
    ).toEqual([]);
  }, 60000);
  it.each([{ methods: [] }, { methods: ["oauth"] }, { methods: ["api-key"] }])(
    "generates independently switched chat, portal and MCP authentication methods: $methods",
    async ({ methods }) => {
      const config = aiFixture();
      Object.assign(config.backends[0], {
        ai: {
          enabled: true,
          mcp: { enabled: methods.length > 0, ...(methods.length ? { authMethods: methods } : {}) },
        },
      });
      Object.assign(config.frontends[0], {
        ai: {
          enabled: true,
          backend: "api",
          chat: { enabled: true, placement: "page" },
          connectPortal: { enabled: methods.length > 0 },
        },
      });
      const backend = backendFiles(config);
      const files = Object.fromEntries(
        Object.entries(backend)
          .filter(([name]) => name.endsWith(".ts") && !name.includes("mcp-gateway"))
          .map(([name, content]) => [name.replace("apps/api/", ""), content]),
      );
      expect(await generatedTypeErrors(files), methods.join(",")).toEqual([]);
      const frontend = generateFrontend(
        resolvedFixture(config),
        "web",
      ).virtualFileSystem.snapshot();
      expect(frontend["apps/web/src/app/chat/page.tsx"]).toContain('requirePageSession("/chat")');
      expect(Object.keys(backend).some((path) => path.includes("/mcp-gateway/"))).toBe(
        methods.length > 0,
      );
    },
    60000,
  );
  it("selects providers from runtime keys in priority order and applies model overrides", () => {
    const create = (provider: string) => (options: { apiKey: string }) => (model: string) => ({
      provider,
      model,
      key: options.apiKey,
    });
    const load = generatedRuntime(backendFiles(), {
      "@ai-sdk/openai": { createOpenAI: create("openai") },
      "@ai-sdk/anthropic": { createAnthropic: create("anthropic") },
      "@ai-sdk/google": { createGoogleGenerativeAI: create("google") },
      "@ai-sdk/groq": { createGroq: create("groq") },
    });
    const { selectModel } = load("apps/api/src/platform/ai/model.ts") as {
      selectModel: (env: Record<string, string>) => unknown;
    };
    expect(
      selectModel({ OPENAI_API_KEY: "a", ANTHROPIC_API_KEY: "b", GEMINI_API_KEY: "c" }),
    ).toMatchObject({ provider: "openai", model: "gpt-4o-mini" });
    expect(selectModel({ ANTHROPIC_API_KEY: "b", GEMINI_API_KEY: "c" })).toMatchObject({
      provider: "anthropic",
      model: "claude-3-5-sonnet-latest",
    });
    expect(selectModel({ GEMINI_API_KEY: "c" })).toMatchObject({
      provider: "google",
      model: "gemini-1.5-flash",
    });
    expect(selectModel({ GEMINI_API_KEY: "c", GROQ_API_KEY: "d" })).toMatchObject({
      provider: "google",
    });
    expect(selectModel({ GROQ_API_KEY: "d" })).toMatchObject({
      provider: "groq",
      model: "openai/gpt-oss-20b",
    });
    expect(selectModel({ GROQ_API_KEY: "d", AI_MODEL: "openai/gpt-oss-120b" })).toMatchObject({
      provider: "groq",
      model: "openai/gpt-oss-120b",
    });
    expect(selectModel({ OPENAI_API_KEY: "a", AI_MODEL: " custom-model " })).toMatchObject({
      model: "custom-model",
    });
    expect(() => selectModel({ OPENAI_API_KEY: " " })).toThrow("Configure OPENAI_API_KEY");
  });
  it("preserves scalar, enum, date, array and nullable contracts in generated tools across module families", async () => {
    const config = aiFixture();
    Object.assign(config.entities.Note.fields, {
      count: { type: "number", format: "integer" },
      amount: { type: "number", format: "float" },
      active: { type: "boolean" },
      when: { type: "date", required: false },
      code: { type: "uuid" },
      payload: { type: "json" },
      state: { type: "enum", enumName: "State" },
      free: { type: "string" },
    });
    config.enums.State = ["active", "archived"];
    config.endpoints[0].queryParams.push({
      name: "dates",
      field: { entity: "Note", field: "when" },
      operator: "in",
      required: false,
    } as never);
    config.endpoints[0].summary = "Search notes";
    config.entities.Note.description = "User notes";
    Object.assign(config.backends[0], {
      ai: {
        enabled: true,
        mcp: { enabled: true },
        tools: { requireConfirmationOnMutations: false },
      },
      iac: { r2_storage: ["uploads"] },
    });
    Object.assign(config, { iac: { cloudflare: { r2_storage: { uploads: {} } } } });
    for (const architecture of ["hexagonal", "onion"]) {
      config.backends[0].modules.notes.architecture = architecture as "hexagonal" | "onion";
      const files = backendFiles(config);
      const tools = files["apps/api/src/platform/ai/generated-tools.ts"];
      expect(tools).toContain("z.array(z.string().datetime");
      expect(tools).toContain("z.number().finite().int()");
      expect(tools).toContain("new Date(value)");
      const sources = Object.fromEntries(
        Object.entries(files)
          .filter(
            ([name]) =>
              name.endsWith(".ts") &&
              !name.includes("mcp-gateway") &&
              !name.endsWith("local-server.ts") &&
              !name.includes("platform/storage/"),
          )
          .map(([name, content]) => [name.replace("apps/api/", ""), content]),
      );
      // Storage is a native Worker boundary; the AI renderer must supply it to module composition.
      expect(files["apps/api/src/platform/ai/routes.ts"]).toContain("createStorage(env");
      expect(Object.keys(sources).length).toBeGreaterThan(20);
    }
    const plain = aiFixture();
    Object.assign(plain.frontends[0], {
      ai: {
        enabled: true,
        backend: "api",
        chat: { enabled: false },
        connectPortal: { enabled: true },
      },
    });
    const portal = generateFrontend(resolvedFixture(plain), "web").virtualFileSystem.snapshot();
    expect(portal["apps/web/src/components/ai/connect-portal.tsx"]).toBeTruthy();
    expect(portal["apps/web/src/components/ai/assistant-chat.tsx"]).toBeUndefined();
    Object.assign(plain.frontends[0], { ai: { enabled: true, backend: "api" } });
    expect(
      generateFrontend(resolvedFixture(plain), "web").virtualFileSystem.snapshot()[
        "apps/web/src/components/ai/connect-portal.tsx"
      ],
    ).toBeUndefined();
  });
  it("rejects multiple AI authorities, gateway collisions and reserved tool inputs", () => {
    const codes = (input: unknown) => validateNordixConfig(input).diagnostics.map((d) => d.code);
    const config = aiFixture();
    expect(
      codes({
        ...config,
        backends: [
          ...config.backends,
          { ...config.backends[0], name: "second", path: "apps/second" },
        ],
      }),
    ).toContain("AI_BACKEND_MULTIPLE");
    expect(
      codes({ ...config, frontends: [{ ...config.frontends[0], path: "apps/api/mcp-gateway" }] }),
    ).toContain("AI_GATEWAY_PATH_COLLISION");
    expect(
      codes({
        ...config,
        frontends: [{ ...config.frontends[0], path: "apps/api/mcp-gateway/nested" }],
      }),
    ).toContain("AI_GATEWAY_PATH_COLLISION");
    expect(
      codes({
        ...config,
        frontends: [{ ...config.frontends[0], access: { mode: "public", backend: "other" } }],
      }),
    ).toContain("AI_IDENTITY_MISMATCH");
    expect(
      codes({
        ...config,
        entities: {
          ...config.entities,
          Note: {
            ...config.entities.Note,
            fields: { ...config.entities.Note.fields, confirm: { type: "boolean" } },
          },
        },
      }),
    ).toContain("AI_INPUT_COLLISION");
    const long = aiFixture();
    long.endpoints[0].operationId = "a".repeat(65);
    expect(codes(long)).toContain("AI_TOOL_NAME_INVALID");
    const unknown = aiFixture();
    unknown.endpoints[0].entity = "Missing";
    expect(codes(unknown)).toContain("UNKNOWN_ENDPOINT_ENTITY");
    for (const path of [
      "/mcp/sub",
      "/api/chat",
      "/api/ai/keys",
      "/.well-known/oauth-protected-resource",
      "/token",
    ]) {
      expect(codes({ ...config, endpoints: [{ ...config.endpoints[0], path }] })).toContain(
        "AI_ROUTE_COLLISION",
      );
    }
  });
  it("discovers custom exported tools before builds without editing a registry", async () => {
    const parent = fileURLToPath(new URL("../", import.meta.url));
    const dir = await mkdtemp(join(parent, ".nordixgen-contract-types-"));
    try {
      for (const [name, content] of Object.entries(backendFiles())) {
        const target = join(dir, name.replace("apps/api/", ""));
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, content);
      }
      await writeFile(
        join(dir, "src/platform/ai/refund.tool.ts"),
        'import {defineTool} from "./define-tool.js";import {z} from "zod";export const refund=defineTool({name:"refund",description:"Refund",permission:"notes:write",isDestructive:true,schema:z.object({}),execute:async()=>true});',
      );
      execFileSync(process.execPath, ["scripts/discover-tools.mjs"], { cwd: dir });
      expect(await readFile(join(dir, "src/platform/ai/custom-tools.ts"), "utf8")).toContain(
        'import {refund as custom0} from "./refund.tool.js"',
      );
      const imported = await import(
        `${pathToFileURL(join(dir, "src/platform/ai/custom-tools.ts")).href}?test=discovery`
      );
      expect(imported.default[0].name).toBe("refund");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
describe("shared tool execution and public gateway", () => {
  it("adds custom permissions to IAM and shares custom tools with the secured registry", async () => {
    const files = backendFiles();
    const execute = vi.fn(async () => ({ refunded: true }));
    const custom = {
      name: "processRefund",
      description: "Refund",
      permissions: ["billing:refunds"],
      isDestructive: true,
      schema: zod.z.object({ invoiceId: zod.z.string().uuid() }),
      execute,
    };
    const load = generatedRuntime(files, {
      zod,
      "apps/api/src/platform/ai/custom-tools.ts": { default: [custom] },
      "apps/api/src/platform/database/create-route-dependencies.ts": {
        createRouteDependencies: () => ({ modules: {} }),
      },
    });
    const policy = load("apps/api/src/platform/authorization/policy.ts") as {
      permissions: string[];
    };
    expect(policy.permissions).toContain("billing:refunds");
    const { toolRegistry } = load("apps/api/src/platform/ai/registry.ts") as {
      toolRegistry: (...args: unknown[]) => {
        list: () => Promise<{ name: string }[]>;
        execute: (name: string, input: unknown, confirmed: boolean) => Promise<unknown>;
      };
    };
    const registry = toolRegistry(
      "test",
      new Headers(),
      async () => ({ id: "member", role: "member", permissions: ["billing:refunds"] }),
      new AbortController().signal,
      true,
      undefined,
    );
    expect((await registry.list()).map((tool) => tool.name)).toEqual(["processRefund"]);
    await registry.execute(
      "processRefund",
      { invoiceId: "11111111-1111-4111-8111-111111111111" },
      true,
    );
    expect(execute).toHaveBeenCalledOnce();
  });
  it("filters discovery, rechecks current permissions and requires explicit mutation confirmation", async () => {
    const files = backendFiles();
    let principal: { id: string; role: string; permissions: string[] } | null = {
      id: "user",
      role: "member",
      permissions: ["notes:read"],
    };
    const execute = vi.fn(async () => ({
      ok: true,
      value: [{ entity: { title: "hello" }, joins: {} }],
    }));
    const composition = {
      createRouteDependencies: () => ({
        modules: {
          notes: {
            operations: { listNotes: execute, createNote: execute },
            checkAccess: () => undefined,
          },
        },
      }),
    };
    const load = generatedRuntime(files, {
      zod,
      "apps/api/src/platform/database/create-route-dependencies.ts": composition,
    });
    const { toolRegistry, mcpArguments } = load("apps/api/src/platform/ai/registry.ts") as {
      toolRegistry: (...args: unknown[]) => {
        list: () => Promise<{ name: string }[]>;
        schema: (tool: unknown, mcp: boolean) => { required: string[] };
        execute: (name: string, args: unknown, confirmed?: boolean) => Promise<unknown>;
      };
      mcpArguments: (value: unknown) => { args: unknown; confirmed: boolean };
    };
    const registry = toolRegistry(
      "test",
      new Headers(),
      async () => principal,
      new AbortController().signal,
      true,
      undefined,
    );
    expect((await registry.list()).map((t: { name: string }) => t.name)).toEqual([
      "notes_listNotes",
    ]);
    await expect(
      registry.execute("notes_createNote", { title: "test" }, true),
    ).rejects.toMatchObject({ status: 403 });
    principal.permissions.push("notes:write");
    await expect(registry.execute("notes_createNote", { title: "test" })).rejects.toMatchObject({
      status: 400,
    });
    const write = (await registry.list()).find(
      (t: { name: string }) => t.name === "notes_createNote",
    );
    expect(registry.schema(write, true).required).toContain("confirm");
    const args = mcpArguments({ title: "test", confirm: true });
    await registry.execute("notes_createNote", args.args, args.confirmed);
    expect(execute).toHaveBeenCalledTimes(1);
    await expect(registry.execute("notes_createNote", { title: 5 }, true)).rejects.toMatchObject({
      status: 400,
    });
    principal.permissions = [];
    await expect(registry.execute("notes_listNotes", {})).rejects.toMatchObject({ status: 403 });
    principal = null;
    await expect(registry.list()).rejects.toMatchObject({ status: 401 });
  });
  it("forwards only the MCP/OAuth allowlist over a binding and streams without reading the body", async () => {
    const load = generatedRuntime(backendFiles());
    const gateway = load("apps/api/mcp-gateway/index.ts").default as {
      fetch: (request: Request, env: unknown) => Promise<Response>;
    };
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("event: message\n"));
        controller.close();
      },
    });
    const response = new Response(stream, { headers: { "Content-Type": "text/event-stream" } });
    const fetch = vi.fn(async () => response);
    const env = { BACKEND: { fetch }, OAUTH_ENABLED: "1" };
    for (const path of [
      "/api/notes",
      "/api/auth/iam/me",
      "/api/auth/ai/verify-oauth",
      "/api/auth/api-key/create",
      "/anything",
    ]) {
      expect((await gateway.fetch(new Request(`https://mcp.test${path}`), env)).status).toBe(404);
    }
    expect(fetch).not.toHaveBeenCalled();
    expect(await gateway.fetch(new Request("https://mcp.test/mcp"), env)).toBe(response);
    expect(response.bodyUsed).toBe(false);
    await gateway.fetch(
      new Request("https://mcp.test/token", {
        method: "POST",
        body: "grant_type=test",
        headers: { "x-nordix-client-ip": "spoofed", "cf-connecting-ip": "1.2.3.4" },
      }),
      env,
    );
    const forwarded = fetch.mock.calls.at(-1)?.[0] as Request;
    expect(new URL(forwarded.url).pathname).toBe("/api/auth/oauth2/token");
    expect(forwarded.headers.get("x-nordix-client-ip")).toBe("1.2.3.4");
    expect(
      (
        await gateway.fetch(new Request("https://mcp.test/authorize"), {
          ...env,
          OAUTH_ENABLED: "0",
        })
      ).status,
    ).toBe(404);
  });
});
