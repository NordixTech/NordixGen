import { type ConfigDiagnostic, createDiagnostic } from "../../diagnostics.js";
import type { NordixConfig } from "../schema.js";
import { entitySlug, routePath, scopedOperationName } from "./shared.js";

export function validateAccess(config: NordixConfig): ConfigDiagnostic[] {
  const diagnostics: ConfigDiagnostic[] = [];
  const add = (code: string, path: string, message: string) =>
    diagnostics.push(createDiagnostic(code, path, message));
  for (const [bi, backend] of config.backends.entries()) {
    const path = `backends[${bi}]`;
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
      if (!policy.roles.includes(policy.defaultRole))
        add(
          "DEFAULT_ROLE_UNKNOWN",
          `${path}.authorization.defaultRole`,
          `Default role "${policy.defaultRole}" must occur in roles. Choose a declared least-privilege role.`,
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
    const slugs = new Map<string, string>();
    for (const endpoint of visible) {
      const slug = entitySlug(endpoint.entity);
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
