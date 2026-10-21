import { type ConfigDiagnostic, createDiagnostic } from "../../diagnostics.js";
import { durationSeconds } from "../../project/account-policy.js";
import { IAM_PERMISSIONS, backendPermissions } from "../../project/permissions.js";
import type { NordixConfig } from "../schema.js";
import { entitySlug, routePath, scopedOperationName } from "./shared.js";

export function validateAccess(config: NordixConfig): ConfigDiagnostic[] {
  const diagnostics: ConfigDiagnostic[] = [];
  const add = (code: string, path: string, message: string) =>
    diagnostics.push(createDiagnostic(code, path, message));
  for (const [bi, backend] of config.backends.entries()) {
    const path = `backends[${bi}]`;
    const auth = backend.authentication;
    if (auth) {
      if (
        durationSeconds(auth.smsOtp.cooldown.initialDelay) >
        durationSeconds(auth.smsOtp.cooldown.maxDelay)
      )
        add(
          "SMS_COOLDOWN_INVALID",
          `${path}.authentication.smsOtp.cooldown.maxDelay`,
          "maxDelay must be greater than or equal to initialDelay.",
        );
      if (durationSeconds(auth.smsOtp.cooldown.maxDelay) > 86400)
        add(
          "SMS_COOLDOWN_INVALID",
          `${path}.authentication.smsOtp.cooldown.maxDelay`,
          "maxDelay must not exceed the 24-hour SMS quota window.",
        );
      if (auth.features.includes("email-verification") && !auth.methods.includes("email-password"))
        add(
          "EMAIL_VERIFICATION_REQUIRES_EMAIL_AUTHENTICATION",
          `${path}.authentication.features`,
          "email-verification requires the email-password authentication method.",
        );
      if (auth.identityProviders.length && !auth.methods.includes("email-password"))
        add(
          "OAUTH_REQUIRES_EMAIL_AUTHENTICATION",
          `${path}.authentication.identityProviders`,
          "OAuth providers require email-password authentication.",
        );
      if (auth.allowedEmailDomains && !auth.methods.includes("email-password"))
        add(
          "EMAIL_DOMAIN_REQUIRES_EMAIL_AUTHENTICATION",
          `${path}.authentication.allowedEmailDomains`,
          "Restricted registration requires email-password authentication; phones may only be linked to an existing company account.",
        );
      if (auth.passwordPolicy.minLength > auth.passwordPolicy.maxLength)
        add(
          "PASSWORD_POLICY_INVALID",
          `${path}.authentication.passwordPolicy`,
          "minLength must not exceed maxLength.",
        );
      if (auth.passwordPolicy.numericOnly)
        for (const flag of [
          "requireUppercase",
          "requireLowercase",
          "requireNumber",
          "requireSpecialChar",
        ] as const)
          if (auth.passwordPolicy[flag])
            diagnostics.push(
              createDiagnostic(
                "PASSWORD_COMPLEXITY_IGNORED",
                `${path}.authentication.passwordPolicy.${flag}`,
                "This complexity requirement is ignored in numeric-only mode.",
                "warning",
              ),
            );
    }
    if (
      backend.authentication?.methods.includes("username-password") &&
      !backend.authentication.methods.includes("email-password")
    )
      add(
        "AUTHENTICATION_METHOD_INVALID",
        `${path}.authentication.methods`,
        "Username sign-in extends email/password accounts. Enable email-password as well.",
      );
    if (!backend.authentication && backend.authorization)
      add(
        "AUTHENTICATION_REQUIRED",
        `${path}.authorization`,
        "Authorization requires backend authentication. Enable authentication or omit authorization.",
      );
    if (backend.authorization) {
      const policy = backend.authorization;
      const known = new Set(backendPermissions(config, backend.name));
      if (
        policy.defaultRole === policy.adminRole ||
        (policy.rolePermissions[policy.defaultRole] ?? []).some(
          (permission) =>
            permission === "*" || IAM_PERMISSIONS.some((system) => system === permission),
        )
      )
        add(
          "DEFAULT_ROLE_PRIVILEGED",
          `${path}.authorization.defaultRole`,
          "The signup default role must differ from the configured administrator role and must not grant IAM administration capabilities.",
        );
      for (const [role, grants] of Object.entries(policy.rolePermissions))
        for (const permission of grants)
          if (permission !== "*" && !permission.includes("*") && !known.has(permission))
            add(
              "PERMISSION_UNKNOWN",
              `${path}.authorization.rolePermissions.${role}`,
              `Permission "${permission}" is not an application capability. Declare it on a backend operation or use a built-in IAM/storage permission.`,
            );
      if (!policy.roles.includes(policy.defaultRole))
        add(
          "DEFAULT_ROLE_UNKNOWN",
          `${path}.authorization.defaultRole`,
          `Default role "${policy.defaultRole}" must occur in roles. Choose a declared least-privilege role.`,
        );
      if (!policy.roles.includes(policy.adminRole))
        add(
          "ADMIN_ROLE_UNKNOWN",
          `${path}.authorization.adminRole`,
          `Administrator role "${policy.adminRole}" must occur in roles.`,
        );
      if (Object.hasOwn(policy.rolePermissions, policy.adminRole))
        add(
          "ADMIN_ROLE_PERMISSIONS_RESERVED",
          `${path}.authorization.rolePermissions.${policy.adminRole}`,
          "The administrator role receives all permissions automatically; omit it from rolePermissions.",
        );
      for (const [role, grants] of Object.entries(policy.rolePermissions)) {
        if (!policy.roles.includes(role))
          add(
            "ROLE_UNKNOWN",
            `${path}.authorization.rolePermissions.${role}`,
            `Grant owner "${role}" is not declared in roles. Correct the role or add its declaration.`,
          );
        if (grants.some((p) => p.includes("*") && p !== "*"))
          add(
            "PERMISSION_INVALID",
            `${path}.authorization.rolePermissions.${role}`,
            "Only an entire '*' grant is supported. Replace partial wildcards with concrete permission tokens.",
          );
      }
    }
  }
  for (const [fi, frontend] of config.frontends.entries()) {
    const path = `frontends[${fi}]`;
    const connected = config.backends.filter((b) => frontend.connectsTo.includes(b.name));
    for (const [ci, name] of frontend.connectsTo.entries())
      if (!config.backends.some((b) => b.name === name))
        add(
          "FRONTEND_BACKEND_UNKNOWN",
          `${path}.connectsTo[${ci}]`,
          `Backend "${name}" does not exist. Correct the connection or declare that backend.`,
        );
    const authorities = connected.filter((b) => b.authentication);
    const explicit = frontend.access.backend;
    const selected = explicit
      ? authorities.find((b) => b.name === explicit)
      : authorities.length === 1
        ? authorities[0]
        : undefined;
    if (explicit && !selected)
      add(
        "FRONTEND_IDENTITY_INVALID",
        `${path}.access.backend`,
        `Identity backend "${explicit}" must be connected and authentication-enabled. Select a connected authority.`,
      );
    if (!explicit && authorities.length > 1)
      add(
        "FRONTEND_IDENTITY_AMBIGUOUS",
        `${path}.access.backend`,
        "Several connected backends provide identity. Select one explicitly with access.backend; array order is not identity selection.",
      );
    if (!selected && authorities.length === 0 && frontend.access.mode !== "public")
      add(
        "FRONTEND_IDENTITY_REQUIRED",
        `${path}.access.mode`,
        "Protected pages require a connected authentication authority. Enable/select one or use public mode.",
      );
    if (selected)
      if (frontend.access.publicRoutes?.some((pattern) => pattern === "/profile"))
        add(
          "FRONTEND_ACCESS_ROUTE_INVALID",
          `${path}.access.publicRoutes`,
          "Profile pages always require a verified session.",
        );
    if (selected)
      for (const backend of authorities)
        if (
          backend.name !== selected.name &&
          config.endpoints.some((e) => e.backend === backend.name && (e.authRequired ?? true))
        )
          add(
            "FRONTEND_IDENTITY_MISMATCH",
            `${path}.connectsTo`,
            `Backend "${backend.name}" has secured operations under a different authority. Use public operations only or a separate frontend.`,
          );
    if (
      selected &&
      frontend.access.publicRoutes?.some(
        (pattern) => pattern === "/admin/roles" || pattern === "/admin/**",
      )
    )
      add(
        "FRONTEND_ACCESS_ROUTE_INVALID",
        `${path}.access.publicRoutes`,
        "IAM administration is always protected and cannot be a public route.",
      );
    const inventory = new Set(["/"]);
    const visible = config.endpoints.filter((e) => frontend.connectsTo.includes(e.backend));
    const operations = new Map<string, string>();
    for (const endpoint of visible) {
      const name = scopedOperationName(
        endpoint.backend,
        endpoint.operationId,
        visible.filter((e) => e.operationId === endpoint.operationId).length > 1,
      );
      const previous = operations.get(name);
      if (previous)
        add(
          "GENERATED_NAME_COLLISION",
          `${path}.connectsTo`,
          `Frontend operation "${name}" conflicts between ${previous} and ${endpoint.backend}.${endpoint.operationId}. Rename an operation to keep scoped client exports unique.`,
        );
      operations.set(name, `${endpoint.backend}.${endpoint.operationId}`);
    }
    if (visible.length) inventory.add("/api-explorer");
    const hasStorage = connected.some((backend) => backend.iac?.r2_storage.length);
    if (hasStorage) inventory.add("/r2");
    if (selected?.authentication) inventory.add("/profile");
    const slugs = new Map<string, string>();
    for (const endpoint of visible) {
      const slug = entitySlug(endpoint.entity);
      if (
        (hasStorage && slug === "r2") ||
        (selected &&
          [
            ...(selected.authentication?.methods.includes("email-password")
              ? ["forgot-password", "reset-password"]
              : []),
            "sign-in",
            "sign-up",
            ...(selected.authentication ? ["profile"] : []),
          ].includes(slug))
      )
        add(
          "GENERATED_NAME_COLLISION",
          `${path}.connectsTo`,
          `Entity "${endpoint.entity}" conflicts with a generated platform page. Rename the entity.`,
        );
      const previous = slugs.get(slug);
      if (previous && previous !== endpoint.entity)
        add(
          "GENERATED_NAME_COLLISION",
          path,
          `Entities "${previous}" and "${endpoint.entity}" map to the same page. Rename one entity.`,
        );
      slugs.set(slug, endpoint.entity);
      inventory.add(`/${slug}`);
    }
    const patterns = frontend.access.publicRoutes;
    if (frontend.access.mode !== "mixed" && patterns !== undefined)
      add(
        "FRONTEND_ACCESS_ROUTE_INVALID",
        `${path}.access.publicRoutes`,
        "publicRoutes is only allowed in mixed mode. Remove it or select mixed mode.",
      );
    if (frontend.access.mode === "mixed" && (!patterns || patterns.length === 0))
      add(
        "FRONTEND_ACCESS_ROUTE_INVALID",
        `${path}.access.publicRoutes`,
        "Mixed mode needs a nonempty publicRoutes list. Declare generated public pages or use authenticated mode.",
      );
    const seen: string[] = [];
    const matches = (pattern: string, page: string) =>
      pattern.endsWith("/**")
        ? page === pattern.slice(0, -3) || page.startsWith(`${pattern.slice(0, -3)}/`)
        : page === pattern;
    for (const [pi, pattern] of (patterns ?? []).entries()) {
      const at = `${path}.access.publicRoutes[${pi}]`;
      const base = pattern.endsWith("/**") ? pattern.slice(0, -3) : pattern;
      if (
        pattern === "/**" ||
        !routePath(base) ||
        pattern === "/sign-in" ||
        pattern === "/sign-up" ||
        pattern === "/forgot-password" ||
        pattern === "/reset-password" ||
        ![...inventory].some((page) => matches(pattern, page))
      )
        add(
          "FRONTEND_ACCESS_ROUTE_INVALID",
          at,
          "This pattern must name a generated business page or a matching trailing '/**' subtree. Authentication pages are already public; use public mode for all pages. Remove query strings, fragments and unsupported wildcards.",
        );
      if (
        seen.some(
          (previous) =>
            matches(previous, base) ||
            matches(pattern, previous.endsWith("/**") ? previous.slice(0, -3) : previous),
        )
      )
        add(
          "FRONTEND_ACCESS_ROUTE_INVALID",
          at,
          "This public route overlaps an earlier pattern. Remove redundant overlapping rules.",
        );
      seen.push(pattern);
    }
  }
  return diagnostics;
}
