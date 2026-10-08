import { describe, expect, it } from "vitest";
import { cleanArchitecturePlugin, resolveCleanArchitectureLayout } from "../src/index.js";
import type { FrameworkContext } from "../src/plugins/contracts.js";

function frameworkContext(codeRoot: string): FrameworkContext {
  return {
    pluginId: "some-framework",
    applicationRoot: "apps/service",
    codeRoot,
    language: "some-language",
    runtime: "some-runtime",
    moduleSystem: "some-module-system",
    scaffold: { executable: "some-tool", argumentsBeforeTarget: [], argumentsAfterTarget: [] },
    entryPoints: {},
    conventions: {},
  };
}

describe("Clean Architecture strategy", () => {
  it("declares an architecture plugin without framework or ORM requirements", () => {
    expect(cleanArchitecturePlugin.descriptor).toEqual({
      id: "clean",
      version: "1.0.0",
      role: "architecture",
      provides: ["architecture:clean"],
      dependencies: { zod: "^3.24.2" },
    });
    expect(cleanArchitecturePlugin.descriptor.requires).toBeUndefined();
    expect(
      cleanArchitecturePlugin.contribute({
        selection: { pluginId: "clean" },
        framework: frameworkContext("apps/service/src"),
        architecture: resolveCleanArchitectureLayout(frameworkContext("apps/service/src")),
        availableCapabilities: new Set(),
      }),
    ).toEqual([]);
  });

  it("maps every semantic file role to a path beneath the framework code root", () => {
    const context = frameworkContext("apps/service/src");
    const layout = resolveCleanArchitectureLayout(context);

    expect(layout).toEqual({
      pluginId: "clean",
      codeRoot: "apps/service/src",
      directories: {
        domainEntity: "domain/entities",
        useCase: "application/use-cases",
        inboundPort: "application/ports/inbound",
        outboundPort: "application/ports/outbound",
        adapter: "infrastructure/adapters",
        controller: "presentation/controllers",
        infrastructure: "infrastructure",
      },
      dependencyRules: [
        { from: "controller", to: "inboundPort" },
        { from: "useCase", to: "inboundPort" },
        { from: "useCase", to: "outboundPort" },
        { from: "useCase", to: "domainEntity" },
        { from: "adapter", to: "outboundPort" },
        { from: "adapter", to: "domainEntity" },
        { from: "infrastructure", to: "adapter" },
      ],
    });
  });

  it("keeps architecture paths rooted under each framework-provided source root", () => {
    const first = resolveCleanArchitectureLayout(frameworkContext("apps/api/src"));
    const second = resolveCleanArchitectureLayout(frameworkContext("src"));

    expect(first.codeRoot).toBe("apps/api/src");
    expect(second.codeRoot).toBe("src");
    expect(first.directories).toEqual(second.directories);
  });

  it("resolves the same layout deterministically for identical contexts", () => {
    const context = frameworkContext("apps/api/src");

    expect(resolveCleanArchitectureLayout(context)).toEqual(
      resolveCleanArchitectureLayout(context),
    );
  });
});
