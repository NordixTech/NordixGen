import { describe, expect, it, vi } from "vitest";
import { generateBackend } from "../src/generation/backend.js";
import { resolvedFixture } from "./fixtures.js";
import { generatedRuntime } from "./generated-runtime.js";

function bootstrap(state?: string, claim = true) {
  const files = generateBackend(resolvedFixture(), "core-api").virtualFileSystem.snapshot();
  const root = "apps/api-core/src/platform/database";
  let recorded = state;
  const migrate = vi.fn(async () => {});
  const seed = vi.fn(async () => {});
  const execute = vi.fn(async (query: string) => {
    if (query.startsWith("SELECT")) return { rows: recorded ? [{ state: recorded }] : [] };
    if (query.startsWith("INSERT")) {
      if (claim) recorded = "pending";
      return { rows: claim ? [{ id: 1 }] : [] };
    }
    if (query.startsWith("UPDATE")) recorded = "complete";
    return { rows: [] };
  });
  const load = generatedRuntime(files, {
    "node:url": { fileURLToPath: (url: URL) => url.pathname },
    [`${root}/drizzle-database.ts`]: { createDrizzleDatabase: () => ({ execute }) },
    [`${root}/migrate.ts`]: { runMigrations: migrate },
    [`${root}/seed.ts`]: { seedDatabase: seed },
    "drizzle-orm": { sql: (parts: TemplateStringsArray) => parts.join("") },
  });
  return {
    run: load(`${root}/local-bootstrap.ts`).prepareLocalDatabase as () => Promise<void>,
    migrate,
    seed,
    execute,
  };
}
describe("persistent local database bootstrap", () => {
  it("applies migrations on every start and seeds only once", async () => {
    const f = bootstrap();
    await f.run();
    await f.run();
    expect(f.migrate).toHaveBeenCalledTimes(2);
    expect(f.seed).toHaveBeenCalledTimes(1);
    expect(f.migrate.mock.invocationCallOrder[0]).toBeLessThan(f.seed.mock.invocationCallOrder[0]);
  });
  it("retains a failed seed claim and prevents duplicate inserts on restart", async () => {
    const f = bootstrap();
    f.seed.mockRejectedValueOnce(Error("seed failed"));
    await expect(f.run()).rejects.toThrow("seed failed");
    await expect(f.run()).rejects.toThrow("Local seed previously failed or is running");
    expect(f.seed).toHaveBeenCalledTimes(1);
  });
  it("does not seed after migration failure or a concurrent bootstrap claim", async () => {
    const f = bootstrap();
    f.migrate.mockRejectedValueOnce(Error("migration failed"));
    await expect(f.run()).rejects.toThrow("migration failed");
    expect(f.execute).not.toHaveBeenCalled();
    expect(f.seed).not.toHaveBeenCalled();
    const concurrent = bootstrap(undefined, false);
    await expect(concurrent.run()).rejects.toThrow("Another local bootstrap is running");
    expect(concurrent.seed).not.toHaveBeenCalled();
  });
});
