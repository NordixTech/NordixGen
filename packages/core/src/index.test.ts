import { describe, expect, it } from "vitest";
import { CORE_VERSION, getCoreInfo } from "./index.js";

describe("@nordixgen/core", () => {
  it("should return correct core version and metadata", () => {
    const info = getCoreInfo();
    expect(info.version).toBe(CORE_VERSION);
    expect(info.engine).toContain("NordixGen");
  });
});
