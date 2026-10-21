import { describe, expect, it, vi } from "vitest";
import { generateBackend } from "../src/generation/backend.js";
import { resolvedFixture } from "./fixtures.js";
import { generatedRuntime } from "./generated-runtime.js";

describe("generated stateless HTTP database client reuse", () => {
  it("reuses schema/client setup, separates credentials and invalidates on proxy changes", () => {
    const files = generateBackend(resolvedFixture(), "core-api").virtualFileSystem.snapshot();
    const file = "apps/api-core/src/platform/database/drizzle-database.ts";
    const neon = vi.fn((connection: string) => ({ connection }));
    const drizzle = vi.fn((client: unknown) => ({ client, execute: vi.fn() }));
    const env: Record<string, string | undefined> = {};
    const load = generatedRuntime(
      {
        [file]: files[file],
        "apps/api-core/src/platform/database/schema/index.ts": "export {};",
      },
      {
        "@neondatabase/serverless": { neon, neonConfig: {} },
        "drizzle-orm/neon-http": { drizzle },
      },
      { process: { env } },
    );
    const create = load(file).createDrizzleDatabase as (connection: string) => {
      client: unknown;
      execute: ReturnType<typeof vi.fn>;
    };
    const first = create("postgres://user:secret@db.example/one");
    expect(create("postgres://user:secret@db.example/one")).toBe(first);
    expect(drizzle).toHaveBeenCalledTimes(1);
    // Queries are still executed each time; no row/session/permission cache is introduced.
    first.execute("query-1");
    first.execute("query-2");
    expect(first.execute).toHaveBeenCalledTimes(2);
    const rotated = create("postgres://user:rotated@db.example/one");
    expect(rotated).not.toBe(first);
    const other = create("postgres://user:rotated@db.example/two");
    expect(other).not.toBe(rotated);
    env.NEON_HTTP_PROXY_URL = "http://127.0.0.1:4444/sql";
    const proxied = create("postgres://user:rotated@db.example/two");
    expect(proxied).not.toBe(other);
    expect(create("postgres://user:rotated@db.example/two")).toBe(proxied);
    expect(drizzle).toHaveBeenCalledTimes(4);
    env.NEON_HTTP_PROXY_URL = "http://secret:password@127.0.0.1/sql";
    expect(() => create("postgres://user:rotated@db.example/two")).toThrow("without credentials");
  });
});
