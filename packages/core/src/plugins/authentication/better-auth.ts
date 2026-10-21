import { posix } from "node:path";
import { authAuditPlugin } from "../../generation/audit.js";
import { authAbusePlugin, authAbuseStore } from "../../generation/auth-abuse.js";
import { authDeliverySource } from "../../generation/auth-delivery.js";
import { authPolicyPlugin, passwordPolicySource } from "../../generation/auth-policy.js";
import { DEFAULT_PASSWORD_POLICY, durationSeconds } from "../../project/account-policy.js";
import { iamPlugin } from "../authorization/iam-plugin.js";
import type { BackendRenderContext, GeneratedFile } from "../contracts.js";

interface BetterAuthSelection {
  projectName: string;
  authentication: import("../../project/types.js").ResolvedIdentity;
  authorization: import("../../project/types.js").ResolvedIdentity;
}
function relativeImport(fromFile: string, toFile: string): string {
  const importPath = posix.relative(posix.dirname(fromFile), toFile.replace(/\.ts$/, ".js"));
  return importPath.startsWith(".") ? importPath : `./${importPath}`;
}

function authSchemaContent(
  methods: readonly string[],
  features: readonly string[],
  defaultRole: string,
): string {
  const userColumns = [
    '  id: text("id").primaryKey(),',
    '  name: text("name").notNull(),',
    '  email: text("email").notNull().unique(),',
    '  emailVerified: boolean("email_verified").notNull().default(false),',
    '  image: text("image"),',
    '  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),',
    '  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull(),',
    `  role: text("role").notNull().default(${JSON.stringify(defaultRole)}).references(() => authRoles.id, {onDelete:"restrict"}),`,
  ];
  if (methods.includes("username-password")) {
    userColumns.push('  username: text("username").unique(),');
    userColumns.push('  displayUsername: text("display_username"),');
  }
  if (methods.includes("phone-number")) {
    userColumns.push('  phoneNumber: text("phone_number").unique(),');
    userColumns.push(
      '  phoneNumberVerified: boolean("phone_number_verified").notNull().default(false),',
    );
  }
  if (features.includes("two-factor")) {
    userColumns.push('  twoFactorEnabled: boolean("two_factor_enabled").notNull().default(false),');
  }
  const tables = [
    'export const authAbuseLimit = pgTable("auth_abuse_limit", {key:text("key").primaryKey(),count:integer("count").notNull(),windowStart:bigint("window_start",{mode:"number"}).notNull(),lastRequest:bigint("last_request",{mode:"number"}).notNull()});',
    'export const rateLimit = pgTable("auth_rate_limit", {id:text("id").primaryKey(),key:text("key").notNull().unique(),count:integer("count").notNull(),lastRequest:bigint("last_request",{mode:"number"}).notNull()});',
    `export const authUser = pgTable("auth_user", {\n${userColumns.join("\n")}\n});`,
    [
      'export const session = pgTable("session", {',
      '  id: text("id").primaryKey(),',
      '  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),',
      '  token: text("token").notNull().unique(),',
      '  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),',
      '  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull(),',
      '  ipAddress: text("ip_address"),',
      '  userAgent: text("user_agent"),',
      '  userId: text("user_id").notNull().references(() => authUser.id, { onDelete: "cascade" }),',
      '}, (table) => [index("session_user_id_idx").on(table.userId)]);',
    ].join("\n"),
    [
      'export const account = pgTable("account", {',
      '  id: text("id").primaryKey(),',
      '  accountId: text("account_id").notNull(),',
      '  providerId: text("provider_id").notNull(),',
      '  userId: text("user_id").notNull().references(() => authUser.id, { onDelete: "cascade" }),',
      '  accessToken: text("access_token"),',
      '  refreshToken: text("refresh_token"),',
      '  idToken: text("id_token"),',
      '  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true, mode: "date" }),',
      '  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true, mode: "date" }),',
      '  scope: text("scope"),',
      '  password: text("password"),',
      '  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),',
      '  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull(),',
      '}, (table) => [index("account_user_id_idx").on(table.userId)]);',
    ].join("\n"),
    [
      'export const verification = pgTable("verification", {',
      '  id: text("id").primaryKey(),',
      '  identifier: text("identifier").notNull(),',
      '  value: text("value").notNull(),',
      '  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),',
      '  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }),',
      '  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }),',
      '}, (table) => [index("verification_identifier_idx").on(table.identifier)]);',
    ].join("\n"),
  ];
  if (features.includes("two-factor")) {
    tables.push(
      [
        'export const twoFactor = pgTable("twoFactor", {',
        '  id: text("id").primaryKey(),',
        '  userId: text("user_id").notNull().references(() => authUser.id, { onDelete: "cascade" }),',
        '  secret: text("secret").notNull(),',
        '  backupCodes: text("backup_codes").notNull(),',
        '  verified: boolean("verified").notNull().default(false),',
        '  failedVerificationCount: integer("failed_verification_count").notNull().default(0),',
        '  lockedUntil: timestamp("locked_until", { withTimezone: true, mode: "date" }),',
        '}, (table) => [index("two_factor_user_id_idx").on(table.userId)]);',
      ].join("\n"),
    );
  }
  return [
    'import { bigint, boolean, index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";',
    'import {authRoles} from "./iam-schema.js";',
    "",
    ...tables.flatMap((table) => [table, ""]),
  ].join("\n");
}

function authRuntimeContent(
  context: BackendRenderContext,
  config: BetterAuthSelection,
  authFilePath: string,
  schemaPath: string,
  databasePath: string,
): string {
  const methods = config.authentication.methods;
  const providers = config.authentication.identityProviders;
  const features = config.authentication.features;
  const identity = config.authentication;
  const policy = identity.passwordPolicy ?? DEFAULT_PASSWORD_POLICY;
  const domains = identity.allowedEmailDomains ?? [];
  const emailVerification = features.includes("email-verification") || domains.length > 0;
  const emailDelivery = emailVerification || methods.includes("email-password");
  const limit = identity.rateLimit ?? { enabled: true, window: "60s", max: 10 };
  const limitRule = {
    window: durationSeconds(limit.ip?.window ?? limit.window),
    max: limit.ip?.max ?? limit.max,
  };
  const accountRule = {
    enabled: limit.enabled,
    window: durationSeconds(limit.account?.window ?? "15m"),
    max: limit.account?.max ?? 10,
  };
  const sms = identity.smsOtp ?? {
    dailyLimit: 10,
    cooldown: { initialDelay: "60s", multiplier: 2, maxDelay: "15m" },
  };
  const smsRule = {
    dailyLimit: sms.dailyLimit,
    initialDelay: durationSeconds(sms.cooldown.initialDelay),
    multiplier: sms.cooldown.multiplier,
    maxDelay: durationSeconds(sms.cooldown.maxDelay),
  };
  const projectName = config.projectName;
  const ai = context.domainModel.backend.ai;
  const oauth = ai?.mcp.enabled && ai.mcp.authMethods.includes("oauth");
  const keys = ai?.mcp.enabled && ai.mcp.authMethods.includes("api-key");
  const defaultRole = config.authorization.defaultRole;
  const lines = [
    ...(ai?.mcp.enabled
      ? [
          'import * as aiSchema from "../database/schema/ai-schema.js";',
          `import {${[...(oauth ? ["mcpOAuth", "mcpVerifier"] : []), ...(keys ? ["mcpApiKeys"] : [])].join(",")}} from "../ai/auth.js";`,
        ]
      : []),
    'import { betterAuth } from "better-auth";',
    'import {nordixAuthPolicy,assertAllowedEmail} from "./nordix-auth-policy.js";',
    'import {nordixAbuseProtection} from "./abuse-protection.js";',
    'import {sendAuthEmail,sendSmsOtp,assertEmailDelivery,type DeliveryEnvironment} from "./delivery.js";',
    ...(methods.includes("phone-number")
      ? ['import {phoneNumber} from "better-auth/plugins";']
      : []),
    'import { drizzleAdapter } from "@better-auth/drizzle-adapter";',
    'import { nordixIamPlugin } from "./nordix-iam-plugin.js";',
    'import {nordixAuditPlugin} from "./nordix-audit-plugin.js";',
    'import {createAuditService} from "../audit/runtime.js";',
    'import {createAuditWriter} from "../audit/store.js";',
    ...(methods.includes("username-password")
      ? ['import { username } from "better-auth/plugins";']
      : []),
    ...(features.includes("two-factor")
      ? ['import { twoFactor } from "better-auth/plugins";']
      : []),
    `import * as schema from "${relativeImport(authFilePath, schemaPath)}";`,
    'import * as iamSchema from "../database/schema/iam-schema.js";',
    `import { createDrizzleDatabase } from "${relativeImport(authFilePath, databasePath)}";`,
    "",
    "export interface AuthEnvironment extends DeliveryEnvironment {",
    ...(ai
      ? [
          "  OPENAI_API_KEY?:string;ANTHROPIC_API_KEY?:string;GEMINI_API_KEY?:string;GROQ_API_KEY?:string;AI_MODEL?:string;MCP_PUBLIC_URL?:string;",
        ]
      : []),
    "  DATABASE_URL: string;",
    "  BETTER_AUTH_SECRET: string;",
    "  BETTER_AUTH_URL: string;",
    "  AUTH_TRUSTED_ORIGINS?: string;",
    ...(providers.includes("microsoft") ? ["  MICROSOFT_TENANT_ID?: string;"] : []),
    ...providers.flatMap((provider) => [
      `  ${provider.toUpperCase()}_CLIENT_ID?: string;`,
      `  ${provider.toUpperCase()}_CLIENT_SECRET?: string;`,
    ]),
    ...(emailDelivery ? ["  RESEND_API_KEY?: string;", "  AUTH_EMAIL_FROM?: string;"] : []),
    "}",
    "",
  ];
  const pluginValues = [
    ...(oauth ? ["mcpOAuth(env)", "mcpVerifier(env)"] : []),
    ...(keys ? ["mcpApiKeys()"] : []),
    `nordixAuthPolicy({domains:${JSON.stringify(domains)},emailPassword:${methods.includes("email-password")},phone:${methods.includes("phone-number")},emailDelivery:()=>assertEmailDelivery(env),verifyEmail:${emailVerification}})`,
    `nordixAbuseProtection({connectionString:env.DATABASE_URL,secret:env.BETTER_AUTH_SECRET,account:${JSON.stringify(accountRule)},sms:${JSON.stringify(smsRule)}})`,
    `nordixIamPlugin({connectionString:env.DATABASE_URL,defaultRole:${JSON.stringify(defaultRole)},adminRole:${JSON.stringify(config.authorization.adminRole)},trustedOrigins:getTrustedAuthOrigins(env),audit})`,
    ...(methods.includes("username-password") ? ["username()"] : []),
    ...(features.includes("two-factor") ? ["twoFactor()"] : []),
    ...(methods.includes("phone-number")
      ? [
          `phoneNumber({otpLength:6,expiresIn:600,allowedAttempts:3,phoneNumberValidator:value=>/^\\+[1-9][0-9]{7,14}$/.test(value),sendOTP:({phoneNumber,code})=>sendSmsOtp(env,phoneNumber,code),${domains.length ? "" : "signUpOnVerification:{getTempEmail:phone=>`${phone.slice(1)}@phone.invalid`,getTempName:phone=>phone},"}})`,
        ]
      : []),
    "nordixAuditPlugin(audit)",
  ];
  const providerEntries = providers.map(
    (provider) =>
      `    ${provider}: { clientId: requiredEnvironment(env.${provider.toUpperCase()}_CLIENT_ID, "${provider.toUpperCase()}_CLIENT_ID"), clientSecret: requiredEnvironment(env.${provider.toUpperCase()}_CLIENT_SECRET, "${provider.toUpperCase()}_CLIENT_SECRET")${provider === "microsoft" ? ', tenantId: env.MICROSOFT_TENANT_ID ?? "common"' : ""} },`,
  );
  lines.push(
    "function requiredEnvironment(value: string | undefined, name: string): string {",
    "  if (!value) throw new Error(`Set ${name} in the runtime environment.`);",
    "  return value;",
    "}",
    "",
    "export interface AuthExecutionContext { waitUntil(promise: Promise<unknown>): void; }",
    "",
    "export function getTrustedAuthOrigins(env: AuthEnvironment): string[] {",
    '  const configuredOrigins = [env.BETTER_AUTH_URL, ...(env.AUTH_TRUSTED_ORIGINS ?? "").split(",").map((value) => value.trim()).filter(Boolean)];',
    "  return [...new Set(configuredOrigins.map((value) => new URL(value).origin))];",
    "}",
    "",
    "export function isTrustedAuthOrigin(origin: string | undefined, env: AuthEnvironment): boolean {",
    "  return origin !== undefined && getTrustedAuthOrigins(env).includes(origin);",
    "}",
    "",
    "export function createAuth(env: AuthEnvironment, executionContext?: AuthExecutionContext) {",
    '  if (!env.DATABASE_URL) throw new Error("Set DATABASE_URL in the runtime environment.");',
    '  if (!env.BETTER_AUTH_SECRET || env.BETTER_AUTH_SECRET.length < 32) throw new Error("Set BETTER_AUTH_SECRET to a random value with at least 32 characters.");',
    '  if (!env.BETTER_AUTH_URL) throw new Error("Set BETTER_AUTH_URL in the runtime environment.");',
    ...(ai?.mcp.enabled
      ? [
          '  if(!env.MCP_PUBLIC_URL)throw Error("Set MCP_PUBLIC_URL to the public gateway origin.");',
        ]
      : []),
    ...(emailDelivery
      ? [
          "  const queueAuthEmail = (to: string, subject: string, url: string): Promise<void> => {",
          "    assertEmailDelivery(env);",
          "    return sendAuthEmail(env, to, subject, url);",
          "  };",
        ]
      : []),
    "  const audit=createAuditService(createAuditWriter(env.DATABASE_URL),executionContext);",
    "  return betterAuth({",
    `    appName: ${JSON.stringify(projectName)},`,
    "    baseURL: env.BETTER_AUTH_URL,",
    "    secret: env.BETTER_AUTH_SECRET,",
    "    trustedOrigins: getTrustedAuthOrigins(env),",
    `    session: {expiresIn:${durationSeconds(identity.session?.expiresIn ?? "7d")},updateAge:${durationSeconds(identity.session?.updateAge ?? "1d")}},`,
    `    account: {accountLinking:{enabled:true,trustedProviders:${JSON.stringify(providers)},allowDifferentEmails:false}},`,
    `    rateLimit: {enabled:${limit.enabled},storage:"database",window:${limitRule.window},max:${limitRule.max},customRules:${JSON.stringify({ "/get-session": false, "/iam/*": false, ...Object.fromEntries(["/sign-in/*", "/sign-up/*", "/request-password-reset", "/reset-password", "/set-password", "/change-password", "/send-verification-email", "/phone-number/*", "/two-factor/*"].map((path) => [path, limitRule])) })}},`,
    '    advanced: {ipAddress:{ipAddressHeaders:["x-nordix-client-ip"]}},',
    `    databaseHooks:{user:{create:{before:async (user,ctx)=>{assertAllowedEmail(user.email,${JSON.stringify(domains)});const name=ctx?.path==="/phone-number/verify"&&typeof ctx.body?.name==="string"?ctx.body.name.trim().slice(0,100):"";return {data:name?{...user,name}:user};}},update:{before:async user=>{if(user.email!==undefined)assertAllowedEmail(user.email,${JSON.stringify(domains)});return {data:user};}}}},`,
    `    database: drizzleAdapter(createDrizzleDatabase(env.DATABASE_URL), { provider: "pg", schema: { ...schema, ...iamSchema, ${ai?.mcp.enabled ? "...aiSchema," : ""} user: schema.authUser, auth_roles: iamSchema.authRoles, auth_role_permissions: iamSchema.authRolePermissions } }),`,
    `    user: {validateUserInfo:async ({user,source})=>{if(source.method==="oauth"&&source.action==="link-account"&&!user.emailVerified)return {error:"oauth_email_not_verified",errorDescription:"Verify your provider email before signing in."};if(${JSON.stringify(domains)}.length&&(!user.email||!(${JSON.stringify(domains)} as string[]).includes(user.email.split("@")[1]?.toLowerCase()??"")))return {error:"email_domain_restricted",errorDescription:"Registration restricted to authorized company domains"};}, additionalFields: { role: { type: "string", required: true, defaultValue: ${JSON.stringify(defaultRole)}, input: false } } },`,
    "    emailAndPassword: {",
    `      enabled: ${methods.includes("email-password")},`,
    `      minPasswordLength: ${policy.minLength},`,
    `      maxPasswordLength: ${policy.maxLength},`,
    `      requireEmailVerification: ${emailVerification},`,
    ...(methods.includes("email-password")
      ? [
          '      sendResetPassword: async ({ user, url }) => queueAuthEmail(user.email, "Reset your password", url),',
          "      revokeSessionsOnPasswordReset: true,",
        ]
      : []),
    "    },",
    ...(emailVerification
      ? [
          '    emailVerification: { sendOnSignUp:true,sendVerificationEmail: async ({ user, url }) => queueAuthEmail(user.email, "Verify your email", url) },',
        ]
      : []),
    ...(providers.length > 0 ? ["    socialProviders: {", ...providerEntries, "    },"] : []),
    ...(pluginValues.length > 0 ? [`    plugins: [${pluginValues.join(", ")}],`] : []),
    "  });",
    "}",
    "",
  );
  void context;
  return lines.join("\n");
}

export function generateBetterAuthFiles(context: BackendRenderContext): readonly GeneratedFile[] {
  if (!context.identity)
    throw new Error("A resolved backend identity is required for authentication.");
  const config: BetterAuthSelection = {
    projectName: context.projectName,
    authentication: context.identity,
    authorization: context.identity,
  };
  const persistence = context.persistence;
  if (!persistence) throw new Error("Better Auth requires a persistence context.");
  const infrastructure = posix.join(
    context.framework.codeRoot,
    context.architecture.directories.infrastructure,
  );
  const schemaPath = posix.join(infrastructure, "database/schema/auth-schema.ts");
  const authFilePath = posix.join(infrastructure, "auth/auth.ts");
  const databasePath = posix.join(persistence.directories.adapter, "drizzle-database.ts");
  const methods = config.authentication.methods;
  const features = config.authentication.features;
  const defaultRole = config.authorization.defaultRole;
  return [
    {
      path: posix.join(infrastructure, "auth/password-policy.ts"),
      content: passwordPolicySource(config.authentication.passwordPolicy),
    },
    { path: posix.join(infrastructure, "auth/nordix-auth-policy.ts"), content: authPolicyPlugin },
    { path: posix.join(infrastructure, "auth/delivery.ts"), content: authDeliverySource },
    { path: posix.join(infrastructure, "auth/abuse-store.ts"), content: authAbuseStore },
    { path: posix.join(infrastructure, "auth/abuse-protection.ts"), content: authAbusePlugin },
    { path: posix.join(infrastructure, "auth/nordix-iam-plugin.ts"), content: iamPlugin },
    { path: posix.join(infrastructure, "auth/nordix-audit-plugin.ts"), content: authAuditPlugin },
    {
      path: schemaPath,
      content: authSchemaContent(methods, features, defaultRole),
    },
    {
      path: authFilePath,
      content: authRuntimeContent(context, config, authFilePath, schemaPath, databasePath),
    },
    {
      path: posix.join(infrastructure, "auth/schema.config.ts"),
      content: [
        "// Schema discovery only: no credentials, requests or database connections are used.",
        'import {createAuth} from "./auth.js";',
        "export const auth=createAuth({",
        ' DATABASE_URL:"postgresql://schema:schema@schema.invalid/schema",',
        ' BETTER_AUTH_URL:"https://schema.invalid",',
        ...(context.domainModel.backend.ai?.mcp.enabled
          ? [' MCP_PUBLIC_URL:"https://mcp.schema.invalid",']
          : []),
        ' BETTER_AUTH_SECRET:"schema-discovery-only-not-a-runtime-secret",',
        ...config.authentication.identityProviders.flatMap((provider) => [
          ` ${provider.toUpperCase()}_CLIENT_ID:"schema-only",`,
          ` ${provider.toUpperCase()}_CLIENT_SECRET:"schema-only",`,
        ]),
        "});",
        "",
      ].join("\n"),
    },
    {
      path: posix.join(infrastructure, "auth/README.md"),
      content: [
        "# Authentication runtime configuration",
        "",
        "Set these bindings as runtime secrets or environment variables. Never commit real values.",
        "",
        "- `DATABASE_URL`: Neon PostgreSQL connection string.",
        "- `BETTER_AUTH_SECRET`: random secret of at least 32 characters.",
        "- `BETTER_AUTH_URL`: public base URL of this backend.",
        "- `AUTH_TRUSTED_ORIGINS`: optional comma-separated exact browser origins.",
        "- Protected state-changing API requests require an `Origin` matching `BETTER_AUTH_URL` or `AUTH_TRUSTED_ORIGINS` to prevent cross-site request forgery.",
        ...config.authentication.identityProviders.flatMap((provider) => [
          `- \`${provider.toUpperCase()}_CLIENT_ID\` and \`${provider.toUpperCase()}_CLIENT_SECRET\`: required for ${provider} sign-in.`,
        ]),
        ...(methods.includes("email-password") ||
        config.authentication.allowedEmailDomains?.length ||
        features.includes("email-verification") ||
        features.includes("password-recovery")
          ? [
              "- Email: AUTH_EMAIL_FROM plus RESEND_API_KEY, or SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASSWORD/SMTP_SECURE. Use TLS SMTP ports 465/587 for Workers; port 25 is unavailable.",
            ]
          : []),
        "",
        "Apply database migrations with the generated Drizzle Kit configuration before serving auth requests.",
        "Phone: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM_NUMBER. Microsoft: MICROSOFT_TENANT_ID (default common).",
        "Set NODE_ENV=production on deployments. Missing delivery credentials fail safely; codes/links are logged only outside production. Local Docker includes Mailpit; native local runs may set SMTP_HOST/SMTP_PORT or use console simulation.",
        "",
        "IAM is registered as nordixIamPlugin. Unified audit is recorded asynchronously in audit_logs and queried at /api/auth/iam/audit with iam:roles:manage.",
        "The schema.config.ts entrypoint is for offline Better Auth CLI discovery only. Do not serve it.",
        "From the backend root: pnpm dlx auth@1.7.10 generate --config ./src/platform/auth/schema.config.ts --output ./better-auth-discovered.ts --yes",
        "Review the discovered schema alongside the maintained Drizzle files; do not overwrite business schemas.",
        "IAM writes use request-scoped Neon WebSocket transactions. NEON_HTTP_PROXY_URL also selects the local proxy's WebSocket endpoint.",
        "",
      ].join("\n"),
    },
  ];
}
