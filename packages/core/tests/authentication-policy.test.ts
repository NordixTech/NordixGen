import { type BetterAuthOptions, betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import * as authApi from "better-auth/api";
import { phoneNumber } from "better-auth/plugins";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import * as zod from "zod";
import { AuthenticationSchema } from "../src/configuration/schema.js";
import { validateNordixConfig } from "../src/configuration/validate.js";
import { authDeliverySource } from "../src/generation/auth-delivery.js";
import { authPolicyPlugin, passwordPolicySource } from "../src/generation/auth-policy.js";
import { backendRenderContext, generateBackend } from "../src/generation/backend.js";
import { generateFrontend } from "../src/generation/frontend.js";
import { backendEnvironmentFile } from "../src/generation/runtime-environment.js";
import { generateBetterAuthFiles } from "../src/plugins/authentication/better-auth.js";
import { DEFAULT_PASSWORD_POLICY, durationSeconds } from "../src/project/account-policy.js";
import { createSecuredConfig, resolvedFixture } from "./fixtures.js";
import { generatedRuntime } from "./generated-runtime.js";
import { generatedTypeErrors } from "./generated-types.js";

function configuration(authentication: Record<string, unknown> = {}) {
  const config = createSecuredConfig();
  Object.assign(config.backends[0].authentication, authentication);
  return config;
}
function policyModule(policy = { ...DEFAULT_PASSWORD_POLICY }) {
  return generatedRuntime(
    { "password-policy.ts": passwordPolicySource(policy) },
    { zod },
  )("password-policy.ts") as { passwordSchema: zod.ZodType<string>; passwordPolicy: typeof policy };
}
function policyPlugin(
  domains: string[] = [],
  emailPassword = true,
  phone = true,
  emailDelivery?: () => void,
) {
  const load = generatedRuntime(
    {
      "auth-policy.ts": authPolicyPlugin,
      "password-policy.ts": passwordPolicySource({
        ...DEFAULT_PASSWORD_POLICY,
        minLength: 4,
        maxLength: 6,
        numericOnly: true,
      }),
    },
    { zod, "better-auth/api": authApi },
  );
  return (
    load("auth-policy.ts").nordixAuthPolicy as (options: unknown) => ReturnType<typeof phoneNumber>
  )({ domains, emailPassword, phone, emailDelivery });
}
function runtime(
  options: { domains?: string[]; email?: boolean; rate?: boolean; missingDelivery?: boolean } = {},
) {
  const codes = new Map<string, string>();
  const resetLinks: string[] = [];
  const database: Record<string, Record<string, unknown>[]> = {
    user: [],
    session: [],
    account: [],
    verification: [],
    rateLimit: [],
  };
  const domains = options.domains ?? [];
  const auth = betterAuth({
    baseURL: "http://localhost:8787",
    secret: "authentication-test-secret-32-characters",
    database: memoryAdapter(database),
    emailAndPassword: {
      enabled: options.email ?? true,
      minPasswordLength: 4,
      maxPasswordLength: 6,
      sendResetPassword: async ({ url }) => {
        resetLinks.push(url);
      },
      revokeSessionsOnPasswordReset: true,
    },
    rateLimit: options.rate
      ? {
          enabled: true,
          storage: "database",
          max: 2,
          window: 60,
          customRules: { "/sign-up/email": { max: 2, window: 60 } },
        }
      : { enabled: false },
    advanced: { ipAddress: { ipAddressHeaders: ["x-nordix-client-ip"] } },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            if (domains.length && !domains.includes(user.email.split("@")[1]))
              throw new authApi.APIError("BAD_REQUEST", {
                message: "Registration restricted to authorized company domains",
              });
            return { data: user };
          },
        },
      },
    },
    plugins: [
      policyPlugin(
        domains,
        options.email ?? true,
        true,
        options.missingDelivery
          ? () => {
              throw new authApi.APIError("INTERNAL_SERVER_ERROR", {
                message:
                  "El servicio de envío no está configurado temporalmente. Contacte al administrador",
              });
            }
          : undefined,
      ),
      phoneNumber({
        otpLength: 6,
        expiresIn: 600,
        allowedAttempts: 3,
        phoneNumberValidator: (value) => /^\+[1-9][0-9]{7,14}$/.test(value),
        sendOTP: ({ phoneNumber, code }) => {
          codes.set(phoneNumber, code);
        },
        ...(domains.length
          ? {}
          : {
              signUpOnVerification: { getTempEmail: (phone) => `${phone.slice(1)}@phone.invalid` },
            }),
      }),
    ],
  } satisfies BetterAuthOptions);
  const request = (path: string, body?: unknown, cookie?: string) =>
    auth.handler(
      new Request(`http://localhost:8787/api/auth${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:8787",
          "x-nordix-client-ip": "192.0.2.1",
          ...(cookie ? { cookie } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
  return { request, codes, database, auth, resetLinks };
}
describe("configurable authentication policies", () => {
  it("keeps account routes out of the business directory and rejects conflicting business pages", () => {
    for (const name of ["Profile", "ForgotPassword", "ResetPassword"]) {
      const config = JSON.parse(
        JSON.stringify(configuration({ methods: ["email-password", "phone-number"] })).replaceAll(
          '"Customer"',
          JSON.stringify(name),
        ),
      );
      config.endpoints.push({
        backend: "core-api",
        entity: name,
        operationId: `list${name}`,
        method: "GET",
        path: `/api/${name.toLowerCase()}`,
        authRequired: false,
      });
      expect(
        validateNordixConfig(config).diagnostics.some((d) => d.code === "GENERATED_NAME_COLLISION"),
        JSON.stringify({ name, diagnostics: validateNordixConfig(config).diagnostics }),
      ).toBe(true);
    }
    const files = generateFrontend(
      resolvedFixture(configuration({ methods: ["email-password", "phone-number"] })),
      "store-web",
    ).virtualFileSystem.snapshot();
    const home = files["apps/store-web/src/app/page.tsx"];
    expect(home).not.toContain('href="/forgot-password"');
    expect(home).not.toContain('href="/profile"');
  });
  it("fails safely before recovery account lookup when production delivery is unconfigured", async () => {
    const app = runtime({ missingDelivery: true });
    const response = await app.request("/request-password-reset", {
      email: "unknown@example.com",
      redirectTo: "http://localhost:8787/reset-password",
    });
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      message: "El servicio de envío no está configurado temporalmente. Contacte al administrador",
    });
    expect(app.resetLinks).toEqual([]);
  });
  it("preserves defaults for existing resolved identities and exposes each delivery environment", () => {
    const context = backendRenderContext(resolvedFixture(configuration()), "core-api");
    if (!context.identity) throw Error("Missing identity");
    const legacy = {
      ...context.identity,
      passwordPolicy: undefined,
      session: undefined,
      rateLimit: undefined,
    };
    expect(
      generateBetterAuthFiles({ ...context, identity: legacy }).find((file) =>
        file.path.endsWith("/auth/auth.ts"),
      )?.content,
    ).toContain("minPasswordLength: 8");
    for (const features of [[], ["two-factor"], ["password-recovery"], ["email-verification"]]) {
      const content = backendEnvironmentFile({
        ...context,
        identity: { ...legacy, methods: ["phone-number"], features },
      }).content;
      expect(content).toContain("TWILIO_AUTH_TOKEN=");
      expect(content.includes("SMTP_HOST=")).toBe(
        features.includes("password-recovery") || features.includes("email-verification"),
      );
      const generated = generateBetterAuthFiles({
        ...context,
        identity: { ...legacy, methods: ["phone-number"], features },
      });
      expect(generated.some((file) => file.path.endsWith("/auth/delivery.ts"))).toBe(true);
    }
    const config = configuration({ methods: ["email-password", "phone-number"] });
    config.frontends[0].access = { mode: "mixed", publicRoutes: ["/profile"] };
    expect(
      validateNordixConfig(config).diagnostics.some(
        (d) => d.code === "FRONTEND_ACCESS_ROUTE_INVALID",
      ),
    ).toBe(true);
  });
  it("resets credentials with a one-use token, enforces the PIN policy and revokes sessions", async () => {
    const app = runtime();
    const signup = await app.request("/sign-up/email", {
      name: "Member",
      email: "member@example.com",
      password: "0123",
    });
    const cookie = signup.headers.get("set-cookie") ?? "";
    expect(
      (
        await app.request("/request-password-reset", {
          email: "member@example.com",
          redirectTo: "http://localhost:8787/reset-password",
        })
      ).status,
    ).toBe(200);
    const token = new URL(app.resetLinks[0]).pathname.split("/").pop();
    expect((await app.request("/reset-password", { token, newPassword: "abcd" })).status).toBe(400);
    expect((await app.request("/reset-password", { token, newPassword: "654321" })).status).toBe(
      200,
    );
    expect(await (await app.request("/get-session", undefined, cookie)).json()).toBeNull();
    expect((await app.request("/reset-password", { token, newPassword: "0123" })).status).toBe(400);
    expect(
      (await app.request("/sign-in/email", { email: "member@example.com", password: "0123" }))
        .status,
    ).toBe(401);
    expect(
      (await app.request("/sign-in/email", { email: "member@example.com", password: "654321" }))
        .status,
    ).toBe(200);
  });
  it("links verified OAuth identities to the same local account through actual callbacks", async () => {
    const data: Record<string, Record<string, unknown>[]> = {
      user: [],
      session: [],
      account: [],
      verification: [],
    };
    const auth = betterAuth({
      baseURL: "http://localhost:8787",
      secret: "oauth-test-secret-32-characters-long",
      database: memoryAdapter(data),
      emailAndPassword: { enabled: true },
      rateLimit: { enabled: false },
      account: {
        accountLinking: {
          enabled: true,
          trustedProviders: ["google", "github"],
          allowDifferentEmails: false,
        },
      },
      socialProviders: {
        google: { clientId: "test", clientSecret: "test" },
        github: { clientId: "test", clientSecret: "test" },
      },
    });
    const ctx = await auth.$context;
    for (const provider of ctx.socialProviders) {
      provider.validateAuthorizationCode = async () => ({
        accessToken: "test-access-token",
        tokenType: "Bearer",
      });
      provider.getUserInfo = async () => ({
        user: {
          id: `${provider.id}-member`,
          email: "member@example.com",
          emailVerified: true,
          name: "Member",
        },
        data: { sub: `${provider.id}-member`, id: `${provider.id}-member` },
      });
    }
    const request = (path: string, body?: unknown, cookie?: string) =>
      auth.handler(
        new Request(`http://localhost:8787/api/auth${path}`, {
          method: body ? "POST" : "GET",
          headers: {
            origin: "http://localhost:8787",
            "content-type": "application/json",
            ...(cookie ? { cookie } : {}),
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        }),
      );
    expect(
      (
        await request("/sign-up/email", {
          name: "Member",
          email: "member@example.com",
          password: "password123",
        })
      ).status,
    ).toBe(200);
    data.user[0].emailVerified = true;
    for (const provider of ["google", "github"]) {
      const start = await request("/sign-in/social", { provider, callbackURL: "/" });
      const result = await start.json();
      const state = new URL(result.url).searchParams.get("state");
      const cookie = start.headers
        .getSetCookie()
        .map((value) => value.split(";")[0])
        .join("; ");
      const response = await request(
        `/callback/${provider}?code=external-provider-code&state=${state}`,
        undefined,
        cookie,
      );
      expect(response.status).toBe(302);
      expect(response.headers.get("location")).not.toContain("error=");
    }
    expect(data.user).toHaveLength(1);
    expect(data.account.map((a) => a.providerId).sort()).toEqual([
      "credential",
      "github",
      "google",
    ]);
    expect(new Set(data.account.map((a) => a.userId)).size).toBe(1);
  });
  it("uses an 8-character default and parses bounded human-readable durations", () => {
    expect(AuthenticationSchema.parse({}).passwordPolicy.minLength).toBe(8);
    expect(["15m", "1h", "7d", "60s", 15].map(durationSeconds)).toEqual([
      900, 3600, 604800, 60, 15,
    ]);
    for (const expiresIn of ["0s", "-1h", "1.5d", "5w", "99999999999d", 0])
      expect(AuthenticationSchema.safeParse({ session: { expiresIn } }).success).toBe(false);
  });
  it("keeps numeric complexity warnings nonblocking and rejects inconsistent policies", () => {
    const config = configuration({
      passwordPolicy: {
        minLength: 4,
        maxLength: 6,
        numericOnly: true,
        requireUppercase: true,
        requireLowercase: true,
        requireNumber: true,
        requireSpecialChar: true,
      },
    });
    const result = validateNordixConfig(config);
    expect(result.success).toBe(true);
    expect(result.diagnostics.filter((d) => d.code === "PASSWORD_COMPLEXITY_IGNORED")).toHaveLength(
      4,
    );
    expect(result.diagnostics.every((d) => d.severity === "warning")).toBe(true);
    expect(
      validateNordixConfig(
        configuration({ passwordPolicy: { minLength: 10, maxLength: 6 } }),
      ).diagnostics.some((d) => d.code === "PASSWORD_POLICY_INVALID"),
    ).toBe(true);
    expect(
      validateNordixConfig(
        configuration({ methods: ["phone-number"], identityProviders: ["google"] }),
      ).diagnostics.some((d) => d.code === "OAUTH_REQUIRES_EMAIL_AUTHENTICATION"),
    ).toBe(true);
    expect(
      validateNordixConfig(
        configuration({ methods: ["phone-number"], allowedEmailDomains: ["nordix.tech"] }),
      ).diagnostics.some((d) => d.code === "EMAIL_DOMAIN_REQUIRES_EMAIL_AUTHENTICATION"),
    ).toBe(true);
  });
  it("executes shared PIN and complexity validation including every requirement", () => {
    const pin = policyModule({
      ...DEFAULT_PASSWORD_POLICY,
      minLength: 4,
      maxLength: 6,
      numericOnly: true,
      requireUppercase: true,
      requireNumber: true,
      requireLowercase: true,
      requireSpecialChar: true,
    });
    for (const value of ["0123", "123456"])
      expect(pin.passwordSchema.safeParse(value).success).toBe(true);
    for (const value of ["123", "1234567", "12a4", "１２３４", "1 34"])
      expect(pin.passwordSchema.safeParse(value).success).toBe(false);
    expect(pin.passwordPolicy.requireUppercase).toBe(false);
    const complex = policyModule({
      ...DEFAULT_PASSWORD_POLICY,
      requireUppercase: true,
      requireLowercase: true,
      requireNumber: true,
      requireSpecialChar: true,
    }).passwordSchema;
    expect(complex.safeParse("Abcdef1!").success).toBe(true);
    for (const value of ["abcdef1!", "ABCDEF1!", "Abcdefg!", "Abcdef12", "Abcdef1 "])
      expect(complex.safeParse(value).success).toBe(false);
    expect(policyModule().passwordSchema.safeParse("abcdefgh").success).toBe(true);
  });
  it("emits complete provider/session/rate-limit contracts and protected phone journeys", () => {
    for (const domains of [undefined, ["nordix.tech"]]) {
      const project = resolvedFixture(
        configuration({
          methods: ["email-password", "username-password", "phone-number"],
          identityProviders: ["google", "github", "microsoft", "facebook"],
          allowedEmailDomains: domains,
          passwordPolicy: { minLength: 4, maxLength: 6, numericOnly: true },
          session: { expiresIn: "15m", updateAge: "60s" },
          rateLimit: { enabled: true, max: 3, window: "1m" },
        }),
      );
      const backend = generateBackend(project, "core-api");
      if (!backend.success) throw Error(JSON.stringify(backend.diagnostics));
      const files = backend.virtualFileSystem.snapshot();
      const auth = Object.entries(files).find(([name]) => name.endsWith("/auth/auth.ts"))?.[1];
      expect(auth).toContain("expiresIn:900,updateAge:60");
      expect(auth).toContain('tenantId: env.MICROSOFT_TENANT_ID ?? "common"');
      expect(auth).toContain("facebook: { clientId:");
      expect(auth).toContain("accountLinking:{enabled:true");
      expect(auth).toContain('storage:"database",window:60,max:3');
      expect(auth.includes("signUpOnVerification")).toBe(!domains);
      expect(Object.values(files).join("\n")).toContain(
        'phoneNumber: text("phone_number").unique()',
      );
      for (const [name, content] of Object.entries(files).filter(([name]) => name.endsWith(".ts")))
        expect(
          ts
            .transpileModule(content, {
              reportDiagnostics: true,
              compilerOptions: { target: ts.ScriptTarget.ES2022 },
            })
            .diagnostics?.filter((d) => d.category === ts.DiagnosticCategory.Error),
          name,
        ).toEqual([]);
      const frontend = generateFrontend(project, "store-web").virtualFileSystem.snapshot();
      for (const route of ["forgot-password", "reset-password", "profile"])
        expect(Object.keys(frontend).some((name) => name.endsWith(`/app/${route}/page.tsx`))).toBe(
          true,
        );
      expect(Object.values(frontend).join("\n")).toContain('inputMode="numeric"');
      expect(
        Object.entries(frontend).find(([path]) => path.endsWith("/sign-in-form.tsx"))?.[1],
      ).toContain('label="PIN"');
      expect(Object.values(frontend).join("\n")).toContain('requirePageSession("/profile")');
      expect(
        project.frontends["store-web"].pages.find((p) => p.path === "/forgot-password")
          ?.authenticated,
      ).toBe(false);
    }
    const project = resolvedFixture(
      configuration({ methods: ["phone-number"], identityProviders: [] }),
    );
    const frontend = generateFrontend(project, "store-web").virtualFileSystem.snapshot();
    expect(Object.values(frontend).join("\n")).toContain("return <PhoneForm/>");
    expect(Object.keys(frontend).some((path) => path.endsWith("/forgot-password/page.tsx"))).toBe(
      false,
    );
  });
  it("typechecks the emitted policy and plugin against real Better Auth", async () => {
    expect(
      await generatedTypeErrors({
        "auth-policy.ts": authPolicyPlugin,
        "password-policy.ts": passwordPolicySource(),
      }),
    ).toEqual([]);
  }, 30000);
  it("rejects malformed credentials through the actual Better Auth HTTP handler", async () => {
    const app = runtime();
    for (const password of ["123", "12ab", "1234567"]) {
      expect(
        (
          await app.request("/sign-up/email", {
            name: "Member",
            email: "member@example.com",
            password,
          })
        ).status,
      ).toBe(400);
    }
    expect(
      (
        await app.request("/sign-up/email", {
          name: "Member",
          email: "member@example.com",
          password: "0123",
        })
      ).status,
    ).toBe(200);
    expect(
      (await app.request("/sign-in/email", { email: "member@example.com", password: "0123" }))
        .status,
    ).toBe(200);
    expect(
      (await app.request("/reset-password", { token: "invalid", newPassword: "abcd" })).status,
    ).toBe(400);
    expect(
      (
        await app.request("/sign-in/phone-number", {
          phoneNumber: "+51999999999",
          password: "0123",
        })
      ).status,
    ).toBe(400);
  });
  it("creates phone-only accounts, rejects wrong/reused OTPs and disables password login", async () => {
    const app = runtime({ email: false });
    const phone = "+51999999999";
    expect((await app.request("/phone-number/send-otp", { phoneNumber: "invalid" })).status).toBe(
      400,
    );
    expect((await app.request("/phone-number/send-otp", { phoneNumber: phone })).status).toBe(200);
    const code = app.codes.get(phone) ?? "";
    expect(code).toMatch(/^\d{6}$/);
    expect(
      (
        await app.request("/phone-number/verify", {
          phoneNumber: phone,
          code: code === "000000" ? "111111" : "000000",
        })
      ).status,
    ).toBe(400);
    const response = await app.request("/phone-number/verify", { phoneNumber: phone, code });
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("session_token");
    expect(app.database.user).toHaveLength(1);
    expect(app.database.user[0]).toMatchObject({
      email: "51999999999@phone.invalid",
      phoneNumberVerified: true,
    });
    expect((await app.request("/phone-number/verify", { phoneNumber: phone, code })).status).toBe(
      400,
    );
    expect(
      (
        await app.request("/sign-up/email", {
          name: "Other",
          email: "other@example.com",
          password: "0123",
        })
      ).status,
    ).toBe(400);
  });
  it("blocks phone-only company signup and requires verified company identity to link", async () => {
    const app = runtime({ domains: ["nordix.tech"] });
    const phone = "+51999999999";
    expect(
      (
        await app.request("/sign-up/email", {
          name: "Outsider",
          email: "outsider@example.com",
          password: "0123",
        })
      ).status,
    ).toBe(400);
    await app.request("/phone-number/send-otp", { phoneNumber: phone });
    expect(
      (
        await app.request("/phone-number/verify", {
          phoneNumber: phone,
          code: app.codes.get(phone),
        })
      ).status,
    ).toBe(403);
    expect(app.database.user).toHaveLength(0);
    const signup = await app.request("/sign-up/email", {
      name: "Employee",
      email: "employee@nordix.tech",
      password: "0123",
    });
    const cookie = signup.headers.get("set-cookie") ?? "";
    expect(
      (
        await app.request(
          "/phone-number/verify",
          { phoneNumber: phone, code: "123456", updatePhoneNumber: true },
          cookie,
        )
      ).status,
    ).toBe(403);
    app.database.user[0].emailVerified = true;
    await app.request("/phone-number/send-otp", { phoneNumber: phone });
    expect(
      (
        await app.request(
          "/phone-number/verify",
          {
            phoneNumber: phone,
            code: app.codes.get(phone),
            updatePhoneNumber: true,
            disableSession: true,
          },
          cookie,
        )
      ).status,
    ).toBe(200);
    await app.request("/phone-number/send-otp", { phoneNumber: phone });
    expect(
      (
        await app.request("/phone-number/verify", {
          phoneNumber: phone,
          code: app.codes.get(phone),
        })
      ).status,
    ).toBe(200);
    expect(app.database.user).toHaveLength(1);
  });
  it("returns 429 after the configured per-IP budget", async () => {
    const app = runtime({ rate: true });
    for (let i = 0; i < 2; i++)
      expect(
        (
          await app.request("/sign-up/email", {
            name: "Member",
            email: `member${i}@example.com`,
            password: "0123",
          })
        ).status,
      ).toBe(200);
    expect(
      (
        await app.request("/sign-up/email", {
          name: "Limited",
          email: "limited@example.com",
          password: "0123",
        })
      ).status,
    ).toBe(429);
  });
});

describe("delivery safety", () => {
  function delivery(
    fetchMock = vi.fn().mockResolvedValue({ ok: true }),
    smtp = vi.fn().mockResolvedValue({}),
  ) {
    const log = vi.fn();
    const close = vi.fn();
    const createTransport = vi.fn(() => ({ sendMail: smtp, close }));
    const module = generatedRuntime(
      { "delivery.ts": authDeliverySource },
      { "better-auth/api": authApi, nodemailer: { createTransport } },
      { fetch: fetchMock, console: { log }, process: { env: { NODE_ENV: "production" } } },
    )("delivery.ts") as {
      sendSmsOtp: (env: Record<string, string>, phone: string, code: string) => Promise<void>;
      sendAuthEmail: (
        env: Record<string, string>,
        to: string,
        subject: string,
        url: string,
      ) => Promise<void>;
    };
    return { ...module, log, fetchMock, smtp, close, createTransport };
  }
  it("prints development codes and links and never logs secrets in production", async () => {
    const d = delivery();
    await d.sendSmsOtp({ NODE_ENV: "development" }, "+51999999999", "012345");
    await d.sendAuthEmail(
      { NODE_ENV: "test" },
      "a@example.com",
      "Reset",
      "https://example.com/reset?token=secret",
    );
    expect(d.log).toHaveBeenCalledTimes(2);
    d.log.mockClear();
    for (const env of [{ NODE_ENV: "production" }, {}]) {
      await expect(d.sendSmsOtp(env, "+51999999999", "012345")).rejects.toMatchObject({
        statusCode: 500,
      });
      await expect(
        d.sendAuthEmail(env, "a@example.com", "Reset", "https://example.com/reset?token=secret"),
      ).rejects.toMatchObject({ statusCode: 500 });
    }
    expect(d.log).not.toHaveBeenCalled();
    expect(d.fetchMock).not.toHaveBeenCalled();
  });
  it("delivers through Twilio, Resend and SMTP/Mailpit and sanitizes provider failures", async () => {
    const d = delivery();
    const twilio = {
      NODE_ENV: "production",
      TWILIO_ACCOUNT_SID: "ACtest",
      TWILIO_AUTH_TOKEN: "secret",
      TWILIO_FROM_NUMBER: "+15555555555",
    };
    await d.sendSmsOtp(twilio, "+51999999999", "012345");
    expect(d.fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("api.twilio.com"),
      expect.objectContaining({ method: "POST" }),
    );
    await d.sendAuthEmail(
      { NODE_ENV: "production", RESEND_API_KEY: "secret", AUTH_EMAIL_FROM: "auth@example.com" },
      "a@example.com",
      "Reset",
      "https://example.com/reset",
    );
    await d.sendAuthEmail(
      { NODE_ENV: "development", SMTP_HOST: "mailpit", SMTP_PORT: "1025" },
      "a@example.com",
      "Reset",
      "https://example.com/reset",
    );
    expect(d.smtp).toHaveBeenCalled();
    expect(d.close).toHaveBeenCalled();
    await d.sendAuthEmail(
      {
        NODE_ENV: "production",
        SMTP_HOST: "smtp.example.com",
        SMTP_USER: "user",
        SMTP_PASSWORD: "secret",
        AUTH_EMAIL_FROM: "auth@example.com",
      },
      "a@example.com",
      "Reset",
      "https://example.com/reset",
    );
    expect(d.createTransport).toHaveBeenLastCalledWith(
      expect.objectContaining({ requireTLS: true }),
    );
    expect(d.log).not.toHaveBeenCalled();
    d.fetchMock.mockResolvedValue({ ok: false });
    await expect(d.sendSmsOtp(twilio, "+51999999999", "012345")).rejects.toMatchObject({
      statusCode: 500,
    });
    d.smtp.mockRejectedValue(Error("sensitive provider response"));
    await expect(
      d.sendAuthEmail(
        { NODE_ENV: "test", SMTP_HOST: "mailpit" },
        "a@example.com",
        "Reset",
        "secret",
      ),
    ).rejects.toThrow("El servicio de envío");
  });
});
