import { describe, expect, it } from "vitest";
import { cloudflareConfiguration, cloudflareWorkerName } from "../src/generation/cloudflare.js";

describe("portable Cloudflare destinations", () => {
  it("keeps long application names distinct within Cloudflare's name limit", () => {
    const project = `project-${"a".repeat(70)}`;
    const first = cloudflareWorkerName(project, "first");
    const second = cloudflareWorkerName(project, "second");
    expect(first).not.toBe(second);
    expect(cloudflareWorkerName(project, "first")).toBe(first);
    for (const name of [first, second]) expect(`${name}-production`.length).toBeLessThanOrEqual(63);
  });
  it("declares environment-specific frontend bindings without an account ID", () => {
    const config = cloudflareConfiguration("project", "web", true);
    for (const env of [config.env.staging, config.env.production]) {
      expect(env.services?.[0].service).toBe(env.name);
      expect(env.assets?.directory).toBe(".open-next/assets");
    }
    expect(config).not.toHaveProperty("account_id");
    expect(cloudflareConfiguration("project", "api").main).toBe("src/index.ts");
  });
});
