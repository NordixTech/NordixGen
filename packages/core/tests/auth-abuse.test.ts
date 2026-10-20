import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import * as authApi from "better-auth/api";
import { phoneNumber, username } from "better-auth/plugins";
import { describe, expect, it, vi } from "vitest";
import { AuthenticationSchema } from "../src/configuration/schema.js";
import { validateNordixConfig } from "../src/configuration/validate.js";
import { authAbusePlugin, authAbuseStore } from "../src/generation/auth-abuse.js";
import { generateBackend } from "../src/generation/backend.js";
import { createSecuredConfig, resolvedFixture } from "./fixtures.js";
import { generatedRuntime } from "./generated-runtime.js";
import { generatedTypeErrors } from "./generated-types.js";

type Rule = {
  key: string;
  max: number;
  window: number;
  initialDelay?: number;
  multiplier?: number;
  maxDelay?: number;
};
const loadStore = () =>
  generatedRuntime(
    { "store.ts": authAbuseStore },
    { "@neondatabase/serverless": { Client: class {} } },
  )("store.ts");
function runtime(nativeIp = false) {
  const counters = new Map<string, number>();
  const rules: Rule[][] = [];
  const consume = vi.fn(async (_connection: string, incoming: Rule[]) => {
    rules.push(incoming);
    if (incoming.some((rule) => (counters.get(rule.key) ?? 0) >= rule.max))
      return { retryAfter: 60, nextDelay: 0 };
    for (const rule of incoming) counters.set(rule.key, (counters.get(rule.key) ?? 0) + 1);
    return { retryAfter: 0, nextDelay: 60 };
  });
  const plugin = generatedRuntime(
    { "abuse.ts": authAbusePlugin },
    { "better-auth/api": authApi, "abuse-store.ts": { consumeLimits: consume } },
  )("abuse.ts");
  const data: Record<string, Record<string, unknown>[]> = {
    user: [],
    session: [],
    account: [],
    verification: [],
    rateLimit: [],
  };
  const send = vi.fn();
  const codes = new Map<string, string>();
  const auth = betterAuth({
    baseURL: "http://localhost:8787",
    secret: "test-secret-long-enough-for-private-keys",
    database: memoryAdapter(data),
    emailAndPassword: { enabled: true },
    advanced: { ipAddress: { ipAddressHeaders: ["x-test-ip"] } },
    rateLimit: nativeIp
      ? {
          enabled: true,
          storage: "database",
          window: 60,
          max: 1,
          customRules: {
            "/sign-up/email": false,
            "/get-session": false,
            "/sign-in/*": { window: 60, max: 1 },
          },
        }
      : { enabled: false },
    plugins: [
      plugin.nordixAbuseProtection({
        connectionString: "postgres://test",
        secret: "test-secret",
        account: { enabled: true, window: 900, max: 2 },
        sms: { dailyLimit: 2, initialDelay: 60, multiplier: 2, maxDelay: 900 },
      }),
      username(),
      phoneNumber({
        sendOTP: ({ phoneNumber, code }) => {
          codes.set(phoneNumber, code);
          send();
        },
        signUpOnVerification: { getTempEmail: (p) => `${p.slice(1)}@phone.invalid` },
      }),
    ],
  });
  const post = (path: string, body: unknown, ip = "192.0.2.1", cookie = "") =>
    auth.handler(
      new Request(`http://localhost:8787/api/auth${path}`, {
        method: "POST",
        headers: {
          origin: "http://localhost:8787",
          "content-type": "application/json",
          "x-test-ip": ip,
          cookie,
        },
        body: JSON.stringify(body),
      }),
    );
  const signup = () =>
    post("/sign-up/email", {
      email: "owner@example.com",
      username: "owner",
      name: "Owner",
      password: "Password2026!",
    });
  return { post, signup, rules, consume, send, codes, data };
}

describe("account limits and SMS cooldown", () => {
  it("emits independent IP/account windows and the configured SMS policy", () => {
    const config = createSecuredConfig();
    Object.assign(config.backends[0].authentication, {
      methods: ["email-password", "phone-number"],
      rateLimit: {
        enabled: true,
        ip: { window: "30s", max: 4 },
        account: { window: "1h", max: 12 },
      },
      smsOtp: { dailyLimit: 8, cooldown: { initialDelay: "5s", multiplier: 1, maxDelay: "10s" } },
    });
    const files = generateBackend(resolvedFixture(config), "core-api").virtualFileSystem.snapshot();
    const source =
      Object.entries(files).find(([path]) => path.endsWith("/auth/auth.ts"))?.[1] ?? "";
    expect(source).toContain('storage:"database",window:30,max:4');
    expect(source).toContain('account:{"enabled":true,"window":3600,"max":12}');
    expect(source).toContain('sms:{"dailyLimit":8,"initialDelay":5,"multiplier":1,"maxDelay":10}');
    expect(Object.values(files).join("\n")).toContain('pgTable("auth_abuse_limit"');
  });
  it("validates defaults, legacy IP limits, independent windows and cooldown bounds", () => {
    const legacy = AuthenticationSchema.parse({ rateLimit: { window: "20s", max: 3 } });
    expect(legacy.rateLimit).toMatchObject({
      window: "20s",
      max: 3,
      account: { window: "15m", max: 10 },
    });
    expect(legacy.smsOtp).toEqual({
      dailyLimit: 10,
      cooldown: { initialDelay: "60s", multiplier: 2, maxDelay: "15m" },
    });
    expect(
      AuthenticationSchema.parse({
        rateLimit: { ip: { window: "30s", max: 4 }, account: { window: "1h", max: 12 } },
        smsOtp: { cooldown: { multiplier: 1 } },
      }).rateLimit.ip?.max,
    ).toBe(4);
    for (const cooldown of [{ initialDelay: "5m", maxDelay: "1m" }, { maxDelay: "2d" }]) {
      const config = createSecuredConfig();
      Object.assign(config.backends[0].authentication, {
        smsOtp: {
          dailyLimit: 10,
          cooldown: { initialDelay: "60s", multiplier: 2, maxDelay: "15m", ...cooldown },
        },
      });
      expect(
        validateNordixConfig(config).diagnostics.some((d) => d.code === "SMS_COOLDOWN_INVALID"),
      ).toBe(true);
    }
    for (const smsOtp of [
      { dailyLimit: 0 },
      { cooldown: { multiplier: 0 } },
      { cooldown: { resend: 60 } },
    ])
      expect(AuthenticationSchema.safeParse({ smsOtp }).success).toBe(false);
  });
  it("calculates immediate first send, increasing waits, capped waits, fixed waits and 24h reset", () => {
    const { decideLimit } = loadStore();
    const rule = {
      key: "sms",
      max: 10,
      window: 86400,
      initialDelay: 60,
      multiplier: 2,
      maxDelay: 900,
    };
    const now = 100000000;
    expect(decideLimit(rule, { count: 0, windowStart: 0, lastRequest: 0 }, now)).toMatchObject({
      retryAfter: 0,
      count: 1,
      nextDelay: 60,
    });
    expect(
      decideLimit(rule, { count: 1, windowStart: now - 1000, lastRequest: now - 1000 }, now),
    ).toMatchObject({ retryAfter: 59 });
    expect(
      decideLimit(rule, { count: 2, windowStart: now - 1000, lastRequest: now - 1000 }, now),
    ).toMatchObject({ retryAfter: 119 });
    expect(
      decideLimit(rule, { count: 9, windowStart: now - 1000, lastRequest: now - 1000 }, now),
    ).toMatchObject({ retryAfter: 899 });
    expect(
      decideLimit(
        { ...rule, multiplier: 1 },
        { count: 8, windowStart: now - 1000, lastRequest: now - 1000 },
        now,
      ).retryAfter,
    ).toBe(59);
    expect(
      decideLimit(rule, { count: 10, windowStart: now - 1000, lastRequest: now - 1000 }, now)
        .retryAfter,
    ).toBe(86399);
    expect(
      decideLimit(rule, { count: 10, windowStart: now - 86400000, lastRequest: now - 1000 }, now),
    ).toMatchObject({ retryAfter: 0, count: 1, windowStart: now, nextDelay: 60 });
    expect(
      decideLimit(rule, { count: 1, windowStart: now - 60000, lastRequest: now - 60000 }, now)
        .retryAfter,
    ).toBe(0);
  });
  it("blocks the same account across IPs and email/username aliases before credential verification", async () => {
    const app = runtime();
    expect((await app.signup()).status).toBe(200);
    expect(
      (
        await app.post(
          "/sign-in/email",
          { email: "OWNER@example.com", password: "incorrect" },
          "192.0.2.1",
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await app.post(
          "/sign-in/username",
          { username: "owner", password: "incorrect" },
          "192.0.2.2",
        )
      ).status,
    ).toBe(401);
    const blocked = await app.post(
      "/sign-in/email",
      { email: "owner@example.com", password: "Password2026!", updatePhoneNumber: true },
      "192.0.2.3",
    );
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBe("60");
    expect(new Set(app.rules.flat().map((rule) => rule.key)).size).toBe(1);
    expect(app.rules[0][0].key).not.toContain("owner");
  });
  it("shares the same account budget with its linked phone and normalizes unknown email targets", async () => {
    const app = runtime();
    await app.signup();
    const phone = "+51999999999";
    app.data.user[0].phoneNumber = phone;
    app.data.user[0].phoneNumberVerified = true;
    await app.post("/phone-number/send-otp", { phoneNumber: phone });
    expect(
      (await app.post("/sign-in/email", { email: "owner@example.com", password: "wrong" })).status,
    ).toBe(401);
    const valid = app.codes.get(phone);
    const wrong = valid === "000000" ? "111111" : "000000";
    expect(
      (await app.post("/phone-number/verify", { phoneNumber: phone, code: wrong }, "192.0.2.2"))
        .status,
    ).toBe(400);
    expect(
      (await app.post("/phone-number/verify", { phoneNumber: phone, code: valid }, "192.0.2.3"))
        .status,
    ).toBe(429);
    const unknown = runtime();
    for (const email of ["unknown@example.com", "UNKNOWN@example.com"])
      expect((await unknown.post("/sign-in/email", { email, password: "wrong" })).status).toBe(401);
    expect(
      (
        await unknown.post(
          "/sign-in/email",
          { email: "unknown@example.com", password: "wrong" },
          "192.0.2.3",
        )
      ).status,
    ).toBe(429);
  });
  it("retains the independent IP limit while another IP can use the remaining account budget", async () => {
    const app = runtime(true);
    await app.signup();
    const body = { email: "owner@example.com", password: "wrong" };
    expect((await app.post("/sign-in/email", body)).status).toBe(401);
    expect((await app.post("/sign-in/email", body)).status).toBe(429);
    expect((await app.post("/sign-in/email", body, "192.0.2.2")).status).toBe(401);
    expect((await app.post("/sign-in/email", body, "192.0.2.3")).status).toBe(429);
  });
  it("shares SMS destination budgets across IPs, exposes cooldowns, and never calls delivery when blocked", async () => {
    const app = runtime();
    const body = { phoneNumber: "+51999999999" };
    for (const ip of ["192.0.2.1", "192.0.2.2"]) {
      const r = await app.post("/phone-number/send-otp", body, ip);
      expect(r.status).toBe(200);
      expect(r.headers.get("x-sms-retry-after")).toBe("60");
    }
    expect((await app.post("/phone-number/send-otp", body, "192.0.2.3")).status).toBe(429);
    expect(app.send).toHaveBeenCalledTimes(2);
  });
  it("also caps the authenticated actor when they change destinations and fails closed on store failure", async () => {
    const app = runtime();
    const signup = await app.signup();
    const cookie = signup.headers.get("set-cookie") ?? "";
    for (const p of ["+51999999991", "+51999999992"])
      expect(
        (await app.post("/phone-number/send-otp", { phoneNumber: p }, "192.0.2.1", cookie)).status,
      ).toBe(200);
    expect(
      (
        await app.post(
          "/phone-number/send-otp",
          { phoneNumber: "+51999999993" },
          "192.0.2.2",
          cookie,
        )
      ).status,
    ).toBe(429);
    expect(app.rules[0]).toHaveLength(2);
    expect(app.send).toHaveBeenCalledTimes(2);
    app.consume.mockRejectedValueOnce(Error("private database detail"));
    const failure = await app.post("/phone-number/send-otp", { phoneNumber: "+51999999994" });
    expect(failure.status).toBe(503);
    expect(await failure.text()).not.toContain("private database detail");
    expect(app.send).toHaveBeenCalledTimes(2);
  });
  it("typechecks the generated store and hooks against installed Better Auth and Neon", async () => {
    expect(
      await generatedTypeErrors({
        "abuse-protection.ts": authAbusePlugin,
        "abuse-store.ts": authAbuseStore,
      }),
    ).toEqual([]);
  }, 30000);
});
