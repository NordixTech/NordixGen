import { describe, expect, it, vi } from "vitest";
import { parseDocument } from "yaml";

vi.mock("yaml", () => ({
  parseDocument: vi.fn((_source: string) => ({
    errors: [],
    toJS: () => {
      throw "conversion failed";
    },
  })),
}));

import { parseNordixYaml } from "../src/configuration/validate.js";

describe("YAML conversion failures", () => {
  it("returns diagnostics for non-Error conversion failures", () => {
    expect(parseNordixYaml("anything")).toMatchObject({
      success: false,
      diagnostics: [
        {
          code: "YAML_CONVERSION_ERROR",
          message: "YAML could not be converted to a data structure.",
        },
      ],
    });
  });

  it("preserves messages from Error conversion failures", () => {
    vi.mocked(parseDocument).mockImplementationOnce(
      () =>
        ({
          errors: [],
          toJS: () => {
            throw new Error("invalid conversion");
          },
        }) as never,
    );
    expect(parseNordixYaml("anything")).toMatchObject({
      success: false,
      diagnostics: [{ code: "YAML_CONVERSION_ERROR", message: "invalid conversion" }],
    });
  });

  it("formats syntax diagnostics that do not include a source position", () => {
    vi.mocked(parseDocument).mockImplementationOnce(
      () =>
        ({
          errors: [{ message: "unlocated parse error" }],
        }) as never,
    );
    expect(parseNordixYaml("anything")).toMatchObject({
      success: false,
      diagnostics: [{ code: "YAML_SYNTAX_ERROR", path: "", message: "unlocated parse error" }],
    });
  });
});
