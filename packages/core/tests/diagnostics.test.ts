import { describe, expect, it } from "vitest";
import { createDiagnostic, formatDiagnostic } from "../src/diagnostics.js";

describe("diagnostic formatting", () => {
  it("formats located and global errors and warnings", () => {
    expect(
      formatDiagnostic(createDiagnostic("BAD_FIELD", "entities.User.name", "Invalid field")),
    ).toBe("ERROR BAD_FIELD at entities.User.name: Invalid field");
    expect(
      formatDiagnostic(createDiagnostic("YAML_SYNTAX_ERROR", "", "Unexpected token", "warning")),
    ).toBe("WARNING YAML_SYNTAX_ERROR: Unexpected token");
  });
});
