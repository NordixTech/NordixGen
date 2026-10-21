import { describe, expect, it } from "vitest";
import { validateNordixConfig } from "../src/configuration/validate.js";
import { generateFrontend } from "../src/generation/frontend.js";
import { createSecuredConfig, createValidConfig, resolvedFixture } from "./fixtures.js";

describe("dashboard generation variants", () => {
  it("keeps a standalone public frontend free of identity and AI imports", () => {
    const config = createValidConfig();
    config.endpoints = [];
    const files = generateFrontend(
      resolvedFixture(config),
      "store-web",
    ).virtualFileSystem.snapshot();
    const shell = files["apps/store-web/src/components/layout/app-shell.tsx"];
    expect(shell).not.toContain("useSessionView");
    expect(shell).not.toContain("AuthControls");
    expect(shell).not.toContain('"label":"API Explorer"');
    expect(shell).not.toContain('"label":"AI Assistant"');
    expect(files["apps/store-web/src/app/profile/page.tsx"]).toBeUndefined();
    expect(files["apps/store-web/src/app/audit/page.tsx"]).toBeUndefined();
    expect(files["apps/store-web/src/styles/dashboard.css"]).toContain("data:font/woff;base64,");
    expect(files["apps/store-web/public/fonts/CaesarDressing-OFL.txt"]).toContain(
      "SIL OPEN FONT LICENSE",
    );
  });
  it("generates a protected audit destination and rejects public overrides and business route collisions", () => {
    const config = createSecuredConfig();
    const project = resolvedFixture(config);
    const files = generateFrontend(project, "store-web").virtualFileSystem.snapshot();
    expect(
      project.frontends["store-web"].pages.find((page) => page.path === "/audit")?.authenticated,
    ).toBe(true);
    expect(files["apps/store-web/src/app/audit/page.tsx"]).toContain(
      'requireIamAccess("iam:roles:manage")',
    );
    expect(files["apps/store-web/src/components/iam/audit-log.tsx"]).toContain(
      'session.hasPermission("iam:roles:manage")',
    );
    expect(files["apps/store-web/src/components/layout/app-shell.tsx"]).toContain(
      'link.href!=="/audit"||canAudit',
    );
    config.frontends[0].access = { mode: "mixed", publicRoutes: ["/audit"] };
    expect(
      validateNordixConfig(config).diagnostics.some(
        (d) => d.code === "FRONTEND_ACCESS_ROUTE_INVALID",
      ),
    ).toBe(true);
    const collision = JSON.parse(
      JSON.stringify(createSecuredConfig()).replaceAll('"Customer"', '"Audit"'),
    );
    collision.endpoints.push({
      backend: "core-api",
      entity: "Audit",
      operationId: "listAudit",
      method: "GET",
      path: "/api/audit",
    });
    expect(
      validateNordixConfig(collision).diagnostics.some(
        (d) => d.code === "GENERATED_NAME_COLLISION",
      ),
    ).toBe(true);
  });
  it.each([false, true])("always protects the profile, with phone capability %s", (phone) => {
    const config = createSecuredConfig();
    Object.assign(config.backends[0].authentication, {
      methods: phone ? ["email-password", "phone-number"] : ["email-password"],
    });
    const project = resolvedFixture(config);
    const files = generateFrontend(project, "store-web").virtualFileSystem.snapshot();
    expect(
      project.frontends["store-web"].pages.find((page) => page.path === "/profile")?.authenticated,
    ).toBe(true);
    expect(files["apps/store-web/src/app/profile/page.tsx"]).toContain(
      'requirePageSession("/profile")',
    );
    const profile = files["apps/store-web/src/components/auth/profile-card.tsx"];
    expect(profile.includes("<PhoneForm link/>")).toBe(phone);
    expect(files["apps/store-web/src/components/auth/auth-controls.tsx"]).toContain(
      'href="/profile"',
    );
    const shell = files["apps/store-web/src/components/layout/app-shell.tsx"];
    expect(shell).toContain('session.hasPermission("iam:roles:manage")');
  });
  it("rejects a business Profile page even without phone authentication", () => {
    const config = JSON.parse(
      JSON.stringify(createSecuredConfig()).replaceAll('"Customer"', '"Profile"'),
    );
    config.endpoints.push({
      backend: "core-api",
      entity: "Profile",
      operationId: "listProfiles",
      method: "GET",
      path: "/api/profiles",
    });
    expect(
      validateNordixConfig(config).diagnostics.some((d) => d.code === "GENERATED_NAME_COLLISION"),
    ).toBe(true);
  });
  it.each(["page", "floating", "disabled"])(
    "places optional AI navigation in the sidebar: %s",
    (placement) => {
      const config = createSecuredConfig();
      Object.assign(config.backends[0], {
        ai: { enabled: true, mcp: { enabled: true, authMethods: ["oauth", "api-key"] } },
      });
      Object.assign(config.frontends[0], {
        ai: {
          enabled: true,
          backend: "core-api",
          chat: {
            enabled: placement !== "disabled",
            placement: placement === "disabled" ? "page" : placement,
          },
          connectPortal: { enabled: true },
        },
      });
      const files = generateFrontend(
        resolvedFixture(config),
        "store-web",
      ).virtualFileSystem.snapshot();
      const shell = files["apps/store-web/src/components/layout/app-shell.tsx"];
      expect(shell).toContain('"label":"AI Connection"');
      expect(shell.includes('"label":"AI Assistant"')).toBe(placement !== "disabled");
      if (placement !== "disabled")
        expect(shell).toContain(
          `"href":${JSON.stringify(placement === "page" ? "/chat" : "#assistant")}`,
        );
      expect(files["apps/store-web/src/app/layout.tsx"]).not.toContain('href="/connect-ai"');
    },
  );
});
