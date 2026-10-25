import { describe, expect, it } from "vitest";
import { authInstancesSource } from "../src/generation/auth-instances.js";
import { generatedRuntime } from "./generated-runtime.js";
describe("generated authentication configuration cache", () => {
  it("keeps concurrent API and HTTP request identity and audit execution ownership separate", async () => {
    type Execution = { waitUntil(task: Promise<unknown>): void };
    type Auth = {
      handler(request: Request): Promise<Response>;
      api: { record(value: string, pause: Promise<void>): Promise<string> };
    };
    const factory = generatedRuntime({ "instances.ts": authInstancesSource })("instances.ts")
      .createAuthInstanceCache as (
      build: (env: { SECRET: string }, execution: Execution) => Auth,
    ) => (env: { SECRET: string }, execution?: Execution) => Auth;
    let built = 0;
    const create = factory((_env, execution) => {
      built++;
      return {
        handler: async (request) => {
          const identity = request.headers.get("cookie") ?? "";
          execution.waitUntil(Promise.resolve(identity));
          return new Response(identity);
        },
        api: {
          record: async (value, pause) => {
            await pause;
            execution.waitUntil(Promise.resolve(value));
            return value;
          },
        },
      };
    });
    const alice: Promise<unknown>[] = [];
    const bob: Promise<unknown>[] = [];
    const a = create({ SECRET: "one" }, { waitUntil: (task) => alice.push(task) });
    const b = create({ SECRET: "one" }, { waitUntil: (task) => bob.push(task) });
    expect(built).toBe(1);
    let release = () => {};
    const pause = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = a.api.record("alice", pause);
    const second = b.api.record("bob", Promise.resolve());
    expect(await second).toBe("bob");
    release();
    expect(await first).toBe("alice");
    expect(
      await (
        await a.handler(new Request("http://localhost", { headers: { cookie: "alice-cookie" } }))
      ).text(),
    ).toBe("alice-cookie");
    expect(
      await (
        await b.handler(new Request("http://localhost", { headers: { cookie: "bob-cookie" } }))
      ).text(),
    ).toBe("bob-cookie");
    expect(await Promise.all(alice)).toEqual(["alice", "alice-cookie"]);
    expect(await Promise.all(bob)).toEqual(["bob", "bob-cookie"]);
    create({ SECRET: "rotated" });
    expect(built).toBe(2);
  });
});
