import { posix } from "node:path";
import type { GeneratedFile, GeneratorPlugin, PluginContributionContext } from "../contracts.js";

interface BetterAuthSelection {
  applicationRoot?: string;
  projectName?: string;
  authentication?: {
    methods?: readonly string[];
    identityProviders?: readonly string[];
    features?: readonly string[];
  };
  authorization?: {
    roles?: readonly string[];
    defaultRole?: string;
  };
}

function selectionConfiguration(context: PluginContributionContext): BetterAuthSelection {
  const value = context.selection.configuration;
  if (typeof value !== "object" || value === null) {
    throw new Error("Better Auth requires its validated backend authentication configuration.");
  }
  return value as BetterAuthSelection;
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
    `  role: text("role").notNull().default(${JSON.stringify(defaultRole)}),`,
  ];
  if (methods.includes("username-password")) {
    userColumns.push('  username: text("username").unique(),');
    userColumns.push('  displayUsername: text("display_username"),');
  }
  if (features.includes("two-factor")) {
    userColumns.push('  twoFactorEnabled: boolean("two_factor_enabled").notNull().default(false),');
  }
  const tables = [
    `export const user = pgTable("user", {\n${userColumns.join("\n")}\n});`,
    [
      'export const session = pgTable("session", {',
      '  id: text("id").primaryKey(),',
      '  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),',
      '  token: text("token").notNull().unique(),',
      '  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),',
      '  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull(),',
      '  ipAddress: text("ip_address"),',
      '  userAgent: text("user_agent"),',
      '  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),',
      '}, (table) => [index("session_user_id_idx").on(table.userId)]);',
    ].join("\n"),
    [
      'export const account = pgTable("account", {',
      '  id: text("id").primaryKey(),',
      '  accountId: text("account_id").notNull(),',
      '  providerId: text("provider_id").notNull(),',
      '  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),',
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
        '  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),',
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
    'import { boolean, index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";',
    "",
    ...tables.flatMap((table) => [table, ""]),
  ].join("\n");
}

function authRuntimeContent(
  context: PluginContributionContext,
  config: BetterAuthSelection,
  authFilePath: string,
  schemaPath: string,
  databasePath: string,
): string {
  const methods = config.authentication?.methods ?? ["email-password"];
  const providers = config.authentication?.identityProviders ?? [];
  const features = config.authentication?.features ?? [];
  const projectName = config.projectName ?? "NordixGen application";
  const defaultRole = config.authorization?.defaultRole ?? "user";
  const lines = [
    'import { betterAuth } from "better-auth";',
    'import { drizzleAdapter } from "@better-auth/drizzle-adapter";',
    ...(methods.includes("username-password")
      ? ['import { username } from "better-auth/plugins";']
      : []),
    ...(features.includes("two-factor")
      ? ['import { twoFactor } from "better-auth/plugins";']
      : []),
    `import * as schema from "${relativeImport(authFilePath, schemaPath)}";`,
    `import { createDrizzleDatabase } from "${relativeImport(authFilePath, databasePath)}";`,
    "",
    "export interface AuthEnvironment {",
    "  DATABASE_URL: string;",
    "  BETTER_AUTH_SECRET: string;",
    "  BETTER_AUTH_URL: string;",
    "  AUTH_TRUSTED_ORIGINS?: string;",
    ...providers.flatMap((provider) => [
      `  ${provider.toUpperCase()}_CLIENT_ID?: string;`,
      `  ${provider.toUpperCase()}_CLIENT_SECRET?: string;`,
    ]),
    ...(features.includes("email-verification") || features.includes("password-recovery")
      ? ["  RESEND_API_KEY?: string;", "  AUTH_EMAIL_FROM?: string;"]
      : []),
    "}",
    "",
  ];
  if (features.includes("email-verification") || features.includes("password-recovery")) {
    lines.push(
      "async function sendAuthEmail(env: AuthEnvironment, to: string, subject: string, url: string): Promise<void> {",
      '  if (!env.RESEND_API_KEY || !env.AUTH_EMAIL_FROM) throw new Error("Set RESEND_API_KEY and AUTH_EMAIL_FROM to deliver authentication email.");',
      '  const response = await fetch("https://api.resend.com/emails", {',
      '    method: "POST",',
      '    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },',
      '    body: JSON.stringify({ from: env.AUTH_EMAIL_FROM, to, subject, html: `<p><a href="${url}">Continue</a></p>` }),',
      "  });",
      "  if (!response.ok) throw new Error(`Authentication email delivery failed with status ${response.status}.`);",
      "}",
      "",
    );
  }
  const pluginValues = [
    ...(methods.includes("username-password") ? ["username()"] : []),
    ...(features.includes("two-factor") ? ["twoFactor()"] : []),
  ];
  const providerEntries = providers.map(
    (provider) =>
      `    ${provider}: { clientId: requiredEnvironment(env.${provider.toUpperCase()}_CLIENT_ID, "${provider.toUpperCase()}_CLIENT_ID"), clientSecret: requiredEnvironment(env.${provider.toUpperCase()}_CLIENT_SECRET, "${provider.toUpperCase()}_CLIENT_SECRET") },`,
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
    ...(features.includes("email-verification") || features.includes("password-recovery")
      ? [
          "  const queueAuthEmail = (to: string, subject: string, url: string): Promise<void> => {",
          "    const delivery = sendAuthEmail(env, to, subject, url);",
          "    if (!executionContext) return delivery;",
          '    executionContext.waitUntil(delivery.catch((error: unknown) => { console.error("Authentication email delivery failed.", error); }));',
          "    return Promise.resolve();",
          "  };",
        ]
      : []),
    "  return betterAuth({",
    `    appName: ${JSON.stringify(projectName)},`,
    "    baseURL: env.BETTER_AUTH_URL,",
    "    secret: env.BETTER_AUTH_SECRET,",
    "    trustedOrigins: getTrustedAuthOrigins(env),",
    '    database: drizzleAdapter(createDrizzleDatabase(env.DATABASE_URL), { provider: "pg", schema }),',
    `    user: { additionalFields: { role: { type: "string", required: true, defaultValue: ${JSON.stringify(defaultRole)}, input: false } } },`,
    "    emailAndPassword: {",
    "      enabled: true,",
    "      minPasswordLength: 15,",
    `      requireEmailVerification: ${features.includes("email-verification")},`,
    ...(features.includes("password-recovery")
      ? [
          '      sendResetPassword: async ({ user, url }) => queueAuthEmail(user.email, "Reset your password", url),',
          "      revokeSessionsOnPasswordReset: true,",
        ]
      : []),
    "    },",
    ...(features.includes("email-verification")
      ? [
          '    emailVerification: { sendVerificationEmail: async ({ user, url }) => queueAuthEmail(user.email, "Verify your email", url) },',
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

export const betterAuthPlugin: GeneratorPlugin = {
  descriptor: {
    id: "better-auth",
    version: "1.0.0",
    role: "authentication",
    provides: [
      "authentication:better-auth",
      "authentication:verified-principal",
      "authentication:session",
      "authentication:method:email-password",
      "authentication:method:username-password",
      "authentication:identity-provider:google",
      "authentication:identity-provider:github",
      "authentication:feature:email-verification",
      "authentication:feature:password-recovery",
      "authentication:feature:two-factor",
    ],
    requires: [
      {
        capability: "framework:hono-auth-handler",
        description:
          "Better Auth is initially integrated through the Hono Web Request/Response handler.",
      },
      {
        capability: "language:typescript",
        description: "The Better Auth integration requires a TypeScript backend.",
      },
      {
        capability: "runtime:cloudflare-workers",
        description: "The initial Better Auth integration targets Cloudflare Workers.",
      },
      {
        capability: "runtime:cloudflare-nodejs-compat",
        description:
          "Better Auth requires the nodejs_compat Wrangler compatibility flag on Cloudflare Workers.",
      },
      {
        capability: "orm:drizzle",
        description: "Better Auth persistence uses its Drizzle adapter.",
      },
      {
        capability: "driver:neon-http",
        description: "The initial Better Auth adapter requires the Neon HTTP Drizzle driver.",
      },
      {
        capability: "database:postgres",
        description: "The Better Auth Drizzle adapter is configured for PostgreSQL.",
      },
      {
        capability: "provider:neon",
        description: "The initial Better Auth persistence path supports Neon PostgreSQL.",
      },
    ],
    dependencies: {
      "better-auth": "^1.7.7",
      "@better-auth/drizzle-adapter": "^1.7.7",
    },
  },
  contribute(context): readonly GeneratedFile[] {
    const config = selectionConfiguration(context);
    const persistence = context.persistence;
    if (!persistence) throw new Error("Better Auth requires a persistence context.");
    const infrastructure = posix.join(
      context.framework.codeRoot,
      context.architecture.directories.infrastructure,
    );
    const schemaPath = posix.join(infrastructure, "database/schema/auth-schema.ts");
    const authFilePath = posix.join(infrastructure, "auth/auth.ts");
    const databasePath = posix.join(persistence.directories.adapter, "drizzle-database.ts");
    const methods = config.authentication?.methods ?? ["email-password"];
    const features = config.authentication?.features ?? [];
    const defaultRole = config.authorization?.defaultRole ?? "user";
    return [
      {
        path: schemaPath,
        content: authSchemaContent(methods, features, defaultRole),
      },
      {
        path: authFilePath,
        content: authRuntimeContent(context, config, authFilePath, schemaPath, databasePath),
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
          ...(config.authentication?.identityProviders?.flatMap((provider) => [
            `- \`${provider.toUpperCase()}_CLIENT_ID\` and \`${provider.toUpperCase()}_CLIENT_SECRET\`: required for ${provider} sign-in.`,
          ]) ?? []),
          ...(features.includes("email-verification") || features.includes("password-recovery")
            ? [
                "- `RESEND_API_KEY` and `AUTH_EMAIL_FROM`: required to deliver configured authentication emails.",
              ]
            : []),
          "",
          "Apply database migrations with the generated Drizzle Kit configuration before serving auth requests.",
          "",
        ].join("\n"),
      },
    ];
  },
};
