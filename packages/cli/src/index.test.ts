import { describe, expect, it, vi } from "vitest";
import { CLI_VERSION, checkNodeRuntime, createProgram } from "./index.js";

describe("@nordix-tech/nordixgen", () => {
  it("rejects unpatched Node 24 releases before running generation", () => {
    const warning = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      for (const version of ["22.23.4", "24.0.0", "24.21.0", "24.22.0"])
        expect(checkNodeRuntime(version)).toBe(false);
      for (const version of ["24.22.1", "24.23.0", "26.12.1"])
        expect(checkNodeRuntime(version)).toBe(true);
    } finally {
      warning.mockRestore();
    }
  });
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
