import { describe, expect, it } from "vitest";
import { CLI_VERSION, checkNodeRuntime, createProgram } from "./index.js";

describe("@nordixgen/cli", () => {
  it("should verify node runtime version compatibility", () => {
    const isSupported = checkNodeRuntime();
    expect(typeof isSupported).toBe("boolean");
  });

  it("should create Commander program with metadata", () => {
    const program = createProgram();
    expect(program.name()).toBe("nordixgen");
    expect(program.version()).toContain(CLI_VERSION);
  });
});
