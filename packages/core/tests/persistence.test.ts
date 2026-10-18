import { describe, expect, it } from "vitest";
import type { NordixConfig } from "../src/configuration/schema.js";
import { validateNordixConfig } from "../src/configuration/validate.js";
import { targetConfig } from "./fixtures.js";

describe("named fixed-stack resources and safe project placement", () => {
  const placements: [string, (c: NordixConfig) => void, string][] = [
    [
      "enum/table symbol collision",
      (c) => {
        c.enums.Customer = ["active"];
      },
      "GENERATED_NAME_COLLISION",
    ],
    [
      "normalized enum collision",
      (c) => {
        c.enums.OrderStatus = ["active"];
        c.enums.Order_Status = ["disabled"];
      },
      "GENERATED_NAME_COLLISION",
    ],
    [
      "filesystem device module",
      (c) => {
        c.backends[0].modules.con = {
          architecture: "clean",
          entities: ["Customer"],
          exports: [],
          imports: {},
        };
      },
      "PATH_UNSAFE",
    ],
    [
      "reserved enum symbol",
      (c) => {
        c.enums.class = ["active"];
      },
      "GENERATED_NAME_COLLISION",
    ],
    [
      "reserved entity symbol",
      (c) => {
        c.entities.class = structuredClone(c.entities.Customer);
        c.backends[0].modules.customers.entities.push("class");
      },
      "GENERATED_NAME_COLLISION",
    ],
    [
      "duplicate repository",
      (c) => {
        c.repositories.push(structuredClone(c.repositories[0]));
      },
      "DUPLICATE_NAME",
    ],
    [
      "unknown application repository",
      (c) => {
        c.backends[0].repository = "missing";
      },
      "UNKNOWN_APP_REPOSITORY",
    ],
    [
      "unsafe repository path",
      (c) => {
        c.repositories[0].path = "../outside";
      },
      "PATH_UNSAFE",
    ],
    [
      "remote without organization",
      (c) => {
        c.repositories[0].createRemote = true;
      },
      "REMOTE_REPOSITORY_WITHOUT_ORGANIZATION",
    ],
    [
      "unknown organization",
      (c) => {
        c.repositories[0].organization = "missing";
      },
      "UNKNOWN_REPOSITORY_ORGANIZATION",
    ],
    [
      "duplicate organization",
      (c) => {
        c.organizations = [
          { name: "team", handle: "Nordix" },
          { name: "team", handle: "Nordix" },
        ];
      },
      "DUPLICATE_NAME",
    ],
    [
      "root application overlap",
      (c) => {
        c.frontends[0].path = ".";
      },
      "APP_PATH_OVERLAP",
    ],
    [
      "normalized entity collision",
      (c) => {
        c.entities.Customer_Address = structuredClone(c.entities.CustomerAddress);
        c.backends[0].modules.customers.entities.push("Customer_Address");
      },
      "GENERATED_NAME_COLLISION",
    ],
    [
      "authentication table collision",
      (c) => {
        c.entities.User = structuredClone(c.entities.Customer);
        c.backends[0].modules.customers.entities.push("User");
      },
      "GENERATED_NAME_COLLISION",
    ],
    [
      "filesystem device entity",
      (c) => {
        c.entities.CON = structuredClone(c.entities.Customer);
        c.backends[0].modules.customers.entities.push("CON");
      },
      "PATH_UNSAFE",
    ],
  ];
  it.each(placements)("rejects %s", (_name, mutate, code) => {
    const config = targetConfig();
    mutate(config);
    expect(validateNordixConfig(config).diagnostics).toContainEqual(
      expect.objectContaining({ code, message: expect.stringMatching(/\w+.*[.!]/) }),
    );
  });
  it("permits a named GitHub organization and separate repositories", () => {
    const config = targetConfig();
    config.organizations = [{ name: "team", handle: "NordixTech" }];
    config.repositories[0].organization = "team";
    config.repositories[0].createRemote = true;
    config.repositories[0].path = "server";
    config.repositories.push({
      name: "client",
      path: "client",
      initializeGit: false,
      createRemote: false,
      visibility: "private",
    });
    config.frontends[0].repository = "client";
    expect(validateNordixConfig(config)).toMatchObject({ success: true, diagnostics: [] });
  });
  it("checks named database references and Better Auth persistence", () => {
    const config = targetConfig();
    config.backends[0].persistence.database = "missing";
    expect(validateNordixConfig(config).diagnostics).toContainEqual(
      expect.objectContaining({
        code: "UNKNOWN_BACKEND_DATABASE",
        path: "backends[0].persistence.database",
      }),
    );
    config.backends[0].persistence = undefined;
    expect(validateNordixConfig(config).diagnostics).toContainEqual(
      expect.objectContaining({ code: "AUTHENTICATION_PERSISTENCE_REQUIRED" }),
    );
  });

  it.each([
    "/absolute",
    "C:/drive",
    "../escape",
    "apps//api",
    "apps/api/",
    "apps/./api",
    "apps/CON",
    "apps/name.",
    "apps\\api",
  ])("rejects unsafe application path %s", (path) => {
    const config = targetConfig();
    config.backends[0].path = path;
    expect(validateNordixConfig(config).diagnostics).toContainEqual(
      expect.objectContaining({ code: "PATH_UNSAFE", path: "backends[0].path" }),
    );
  });

  it("rejects overlapping applications/repositories and duplicate application names", () => {
    const config = targetConfig();
    config.frontends[0].path = "APPS/API/subfolder";
    config.frontends[0].name = "api";
    config.repositories.push({
      name: "nested",
      path: "repos/nested",
      initializeGit: false,
      createRemote: false,
      visibility: "private",
    });
    expect(validateNordixConfig(config).diagnostics.map((d) => d.code)).toEqual(
      expect.arrayContaining(["APP_PATH_OVERLAP", "DUPLICATE_APP_NAME", "REPOSITORY_PATH_OVERLAP"]),
    );
  });

  it("rejects selector/provider keys instead of negotiating unsupported stacks", () => {
    const config = targetConfig();
    Object.assign(config.databases.primary, { engine: "mysql", provider: "other" });
    Object.assign(config.backends[0].persistence, { orm: "prisma" });
    const errors = validateNordixConfig(config).diagnostics;
    expect(errors.filter((d) => d.code === "CONFIG_FIELD_REMOVED")).toHaveLength(3);
    expect(errors.every((d) => !d.code.startsWith("PLUGIN"))).toBe(true);
  });
});
