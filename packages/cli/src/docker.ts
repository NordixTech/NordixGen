import { posix } from "node:path";
import type { ResolvedProject } from "@nordixgen/core";
import { stringify } from "yaml";

type Repository = ResolvedProject["repositories"][number];
type Service = Record<string, unknown>;
export const dockerScripts = {
  "docker:up": "docker compose up -d --build",
  "docker:down": "docker compose down -v",
  "docker:logs": "docker compose logs -f",
};
const proxyImage =
  "ghcr.io/timowilhelm/local-neon-http-proxy@sha256:cd2ae14edf2feafbc3330492de5c80506f77274c3bd013154cdef697bdeb768a";
const environmentName = (name: string) => name.toUpperCase().replaceAll("-", "_");
const publicVariable = (name: string) => `NEXT_PUBLIC_${environmentName(name)}_BASE_URL`;
const portVariable = (kind: string, name: string) => `${kind}_${environmentName(name)}_PORT`;
const interpolation = (name: string, fallback: string | number) => `\${${name}:-${fallback}}`;
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
const appDirectory = (path: string) => posix.join("/workspace", path);
const copy = (source: string, target: string, stage?: string) =>
  `COPY ${stage ? `--from=${stage} --chown=nextjs:nodejs ` : ""}${JSON.stringify([source, target])}`;
const base = [
  "# Local development image. Build with the repository root as context.",
  "FROM node:24-bookworm-slim AS deps",
  "RUN npm install --global pnpm@10.5.2",
  "WORKDIR /workspace",
  "COPY . .",
  "RUN pnpm install --frozen-lockfile",
  "",
  "FROM deps AS builder",
];
const runner = [
  "",
  "FROM node:24-bookworm-slim AS runner",
  "ENV NODE_ENV=production",
  "RUN groupadd --system --gid 1001 nodejs && useradd --system --uid 1001 --gid nodejs nextjs",
  "WORKDIR /app",
];
const healthcheck = (port: number, path: string) => ({
  test: [
    "CMD",
    "node",
    "-e",
    `fetch('http://127.0.0.1:${port}${path}').then(r=>process.exit(r.status<400?0:1)).catch(()=>process.exit(1))`,
  ],
  interval: "5s",
  timeout: "3s",
  retries: 30,
  start_period: "30s",
});

/** Resolve the entire project's ports once so independent repositories agree on public origins. */
export function localTopology(project: ResolvedProject) {
  const backends = Object.values(project.backends);
  const frontends = Object.values(project.frontends);
  return {
    backendPort: (name: string) =>
      interpolation(
        portVariable("BACKEND", name),
        8787 + backends.findIndex((app) => app.name === name),
      ),
    frontendPort: (name: string) =>
      interpolation(
        portVariable("FRONTEND", name),
        3000 + frontends.findIndex((app) => app.name === name),
      ),
    databasePort: (name: string) =>
      interpolation(
        portVariable("POSTGRES", name),
        5432 + backends.filter((app) => app.database).findIndex((app) => app.name === name),
      ),
  };
}

export function dockerFiles(
  project: ResolvedProject,
  repository: Repository,
): Record<string, string> {
  const files: Record<string, string> = {};
  const services: Record<string, Service> = {};
  const volumes: Record<string, object> = {};
  const topology = localTopology(project);
  const publicBackend = (name: string) =>
    interpolation(
      `BACKEND_${environmentName(name)}_PUBLIC_URL`,
      `http://localhost:${topology.backendPort(name)}`,
    );
  const publicFrontend = (name: string) => `http://localhost:${topology.frontendPort(name)}`;
  const internalBackend = (name: string) =>
    project.backends[name].repository.name === repository.name
      ? `http://backend-${name}:8787`
      : `http://host.docker.internal:${topology.backendPort(name)}`;
  const build = (path: string, args?: Record<string, string>) => ({
    context: ".",
    dockerfile: posix.join(path, "Dockerfile"),
    ...(args ? { args } : {}),
  });
  const network = ["nordix-local-net"];
  for (const app of Object.values(project.backends).filter(
    (app) => app.repository.name === repository.name,
  )) {
    const db = app.database;
    const directory = appDirectory(app.path);
    files[posix.join(app.path, "Dockerfile")] = [
      ...base,
      `WORKDIR ${directory}`,
      "RUN pnpm run typecheck && node scripts/build-local.mjs",
      ...(db ? ["RUN test -f drizzle/meta/_journal.json"] : []),
      `RUN pnpm --filter ${quote(app.name)} deploy --legacy --prod /out`,
      ...runner,
      copy("/out/node_modules", "./node_modules", "builder"),
      copy("/out/package.json", "./package.json", "builder"),
      copy(`${directory}/.docker-dist`, "./dist", "builder"),
      ...(db ? [copy(`${directory}/drizzle`, "./drizzle", "builder")] : []),
      "USER nextjs",
      "ENV PORT=8787",
      "EXPOSE 8787",
      'CMD ["node", "dist/local-server.js"]',
      "",
    ].join("\n");
    const origins = Object.values(project.frontends)
      .filter((frontend) => frontend.connections.includes(app.name))
      .map((frontend) => publicFrontend(frontend.name))
      .join(",");
    const environment: Record<string, string> = { PORT: "8787" };
    if (app.identity) {
      environment.BETTER_AUTH_URL = publicBackend(app.name);
      environment.BETTER_AUTH_SECRET = interpolation(
        `BACKEND_${environmentName(app.name)}_AUTH_SECRET`,
        `local-development-only-${app.name}-change-before-sharing-0123456789`,
      );
      environment.AUTH_TRUSTED_ORIGINS = interpolation(
        `BACKEND_${environmentName(app.name)}_TRUSTED_ORIGINS`,
        origins,
      );
      for (const provider of app.identity.identityProviders)
        for (const suffix of ["CLIENT_ID", "CLIENT_SECRET"])
          environment[`${provider.toUpperCase()}_${suffix}`] = interpolation(
            `${environmentName(app.name)}_${provider.toUpperCase()}_${suffix}`,
            "",
          );
      if (
        app.identity.features.some(
          (feature) => feature === "email-verification" || feature === "password-recovery",
        )
      ) {
        environment.RESEND_API_KEY = interpolation(
          `${environmentName(app.name)}_RESEND_API_KEY`,
          "",
        );
        environment.AUTH_EMAIL_FROM = interpolation(
          `${environmentName(app.name)}_AUTH_EMAIL_FROM`,
          "",
        );
      }
    } else
      environment.CORS_ALLOWED_ORIGINS = interpolation(
        `BACKEND_${environmentName(app.name)}_TRUSTED_ORIGINS`,
        origins,
      );
    const depends: Record<string, { condition: string }> = {};
    if (db) {
      const postgres = `postgres-${app.name}`;
      const proxy = `neon-${app.name}`;
      // Resource slugs may contain hyphens; PostgreSQL database names are URL path components.
      const connection = `postgres://postgres:postgres@${postgres}:5432/${db.name}`;
      const volume = `postgres_data_${db.name}`;
      volumes[volume] = {};
      services[postgres] = {
        image: "postgres:16-alpine",
        environment: {
          POSTGRES_USER: "postgres",
          POSTGRES_PASSWORD: "postgres",
          POSTGRES_DB: db.name,
        },
        ports: [`127.0.0.1:${topology.databasePort(app.name)}:5432`],
        volumes: [`${volume}:/var/lib/postgresql/data`],
        healthcheck: {
          test: ["CMD-SHELL", `pg_isready -U postgres -d ${db.name}`],
          interval: "5s",
          timeout: "3s",
          retries: 30,
        },
        networks: network,
      };
      services[proxy] = {
        image: proxyImage,
        environment: { PG_CONNECTION_STRING: connection, RUST_LOG: "warn" },
        depends_on: { [postgres]: { condition: "service_healthy" } },
        networks: network,
      };
      environment.DATABASE_URL = connection;
      environment.NEON_HTTP_PROXY_URL = `http://${proxy}:4444/sql`;
      depends[postgres] = { condition: "service_healthy" };
      depends[proxy] = { condition: "service_started" };
    }
    services[`backend-${app.name}`] = {
      build: build(app.path),
      environment,
      ports: [
        `${interpolation(`BACKEND_${environmentName(app.name)}_BIND_ADDRESS`, Object.values(project.frontends).some((frontend) => frontend.repository.name !== repository.name && frontend.connections.includes(app.name)) ? "0.0.0.0" : "127.0.0.1")}:${topology.backendPort(app.name)}:8787`,
      ],
      ...(db ? { depends_on: depends } : {}),
      healthcheck: healthcheck(8787, "/health"),
      networks: network,
      // The proxy may still be binding its listener after the database becomes healthy.
      restart: "on-failure:5",
    };
  }
  for (const app of Object.values(project.frontends).filter(
    (app) => app.repository.name === repository.name,
  )) {
    const directory = appDirectory(app.path);
    const args = Object.fromEntries(
      app.connections.map((name) => [publicVariable(name), publicBackend(name)]),
    );
    if (app.identity) args.NEXT_PUBLIC_AUTH_BASE_URL = publicBackend(app.identity.backend);
    files[posix.join(app.path, "Dockerfile")] = [
      ...base,
      ...Object.keys(args).flatMap((name) => [`ARG ${name}`, `ENV ${name}=$${name}`]),
      `WORKDIR ${directory}`,
      "RUN mkdir -p public && pnpm build",
      ...runner,
      "ENV PORT=3000",
      "ENV HOSTNAME=0.0.0.0",
      copy(`${directory}/.next/standalone`, "./", "builder"),
      copy(`${directory}/.next/static`, `./${posix.join(app.path, ".next/static")}`, "builder"),
      copy(`${directory}/public`, `./${posix.join(app.path, "public")}`, "builder"),
      "USER nextjs",
      "EXPOSE 3000",
      `CMD ${JSON.stringify(["node", posix.join(app.path, "server.js")])}`,
      "",
    ].join("\n");
    const relativeRoot = posix.relative(app.path, ".") || ".";
    files[posix.join(app.path, "next.config.ts")] = `import type {NextConfig} from "next";
import {resolve} from "node:path";
const config:NextConfig={output:"standalone",outputFileTracingRoot:resolve(process.cwd(),${JSON.stringify(relativeRoot)})};
export default config;
`;
    const dependencies = Object.fromEntries(
      app.connections
        .filter((name) => project.backends[name].repository.name === repository.name)
        .map((name) => [`backend-${name}`, { condition: "service_healthy" }]),
    );
    services[`frontend-${app.name}`] = {
      build: build(app.path, args),
      environment: {
        PORT: "3000",
        HOSTNAME: "0.0.0.0",
        ...(app.identity
          ? {
              AUTH_INTERNAL_BASE_URL: interpolation(
                `FRONTEND_${environmentName(app.name)}_AUTH_INTERNAL_URL`,
                internalBackend(app.identity.backend),
              ),
            }
          : {}),
      },
      ports: [`127.0.0.1:${topology.frontendPort(app.name)}:3000`],
      ...(Object.keys(dependencies).length ? { depends_on: dependencies } : {}),
      extra_hosts: ["host.docker.internal:host-gateway"],
      healthcheck: healthcheck(3000, "/"),
      networks: network,
    };
  }
  files["docker-compose.yml"] = stringify({
    name: `${project.project.name}-${repository.name}`.toLowerCase().replace(/[^a-z0-9_-]/g, "-"),
    services,
    ...(Object.keys(volumes).length ? { volumes } : {}),
    networks: { "nordix-local-net": { driver: "bridge" } },
  });
  files[".dockerignore"] = [
    "**/node_modules",
    "**/.next",
    "**/dist",
    "**/.docker-dist",
    "**/.wrangler",
    "**/.open-next",
    "**/.nordixgen",
    "**/.git",
    "**/coverage",
    "**/.env",
    "**/.env.*",
    "!**/.env.example",
    "**/.dev.vars",
    "**/.dev.vars.*",
    "!**/.dev.vars.example",
    "**/*.log",
    "",
  ].join("\n");
  return files;
}

export function dockerDocumentation(project: ResolvedProject, repository: Repository): string[] {
  return [
    "## Local Docker environment",
    "",
    "Requires Docker Engine with Compose v2. Start with `docker compose up -d --build` (no host Node/pnpm required), or `pnpm docker:up`. Each app has its own multi-stage image. Frontends run a standalone Next.js build; this workflow does not provide hot reload.",
    "",
    ...Object.values(project.backends)
      .filter((app) => app.repository.name === repository.name)
      .map(
        (app) =>
          `- Backend \`${app.name}\`: http://localhost:${8787 + Object.keys(project.backends).indexOf(app.name)} (override \`${portVariable("BACKEND", app.name)}\`).${
            app.database
              ? ` Dedicated PostgreSQL 16 volume plus a Neon HTTP proxy; database host port defaults to ${
                  5432 +
                  Object.values(project.backends)
                    .filter((backend) => backend.database)
                    .findIndex((backend) => backend.name === app.name)
                } (override \`${portVariable("POSTGRES", app.name)}\`).`
              : ""
          }`,
      ),
    ...Object.values(project.frontends)
      .filter((app) => app.repository.name === repository.name)
      .map(
        (app) =>
          `- Frontend \`${app.name}\`: http://localhost:${3000 + Object.keys(project.frontends).indexOf(app.name)} (override \`${portVariable("FRONTEND", app.name)}\`).`,
      ),
    "",
    "Set overrides in the repository-root `.env` (ignored by Git). Port defaults are assigned across the whole generated project, including split repositories. Unrelated projects can override ports independently. Never reuse these development-only database credentials or authentication defaults for production.",
    "",
    "Browser API URLs use localhost and are passed as Next.js build arguments. Override `BACKEND_<NAME>_PUBLIC_URL` when using another hostname, and rebuild the frontend. Server-side session/IAM checks use the private `AUTH_INTERNAL_BASE_URL`; Docker service names never enter browser URLs. Backend CORS/trusted origins default to connected frontend localhost ports; override `BACKEND_<NAME>_TRUSTED_ORIGINS` if needed. Names in environment variables use uppercase with hyphens replaced by underscores.",
    "",
    "Each repository runs only its own applications/databases. For split repositories, start the backend repository first, then the frontend repository. Each has its own isolated Compose network and volumes; no external network or sibling checkout is needed. The frontend reaches an external backend through `host.docker.internal` and its published port for server-side identity checks. A backend consumed from another repository binds its published port to all host interfaces so Linux host-gateway routing works (override `BACKEND_<NAME>_BIND_ADDRESS`); other backends default to loopback. Cross-repository availability cannot be expressed with Compose depends_on. Keep port/public-origin overrides consistent in both repositories; override `FRONTEND_<NAME>_AUTH_INTERNAL_URL` for a backend on another machine. External backend availability remains required to use connected features.",
    "",
    "Generation prepares the initial SQL migration and journal once. Keep them in Git; after schema changes run `pnpm db:generate` and review/commit the new SQL before building. Docker builds reuse that migration history, so rebuilding an image never fabricates a fresh initial migration against an existing volume. Startup applies pending migrations and initializes IAM roles. Synthetic business seeds run once per database, recorded in `nordix_local_bootstrap`. A failed/interrupted seed stops subsequent starts with an explicit error instead of inserting duplicates; inspect the database before recovery. Seeds do not create login accounts. Register an operator and promote it with the backend's `auth:create-admin` command when needed. Provider/email credentials must be supplied separately for those optional authentication journeys.",
    "",
    "Use `pnpm docker:logs` / `docker compose logs -f` to inspect services. Stop while preserving data with `docker compose down`. **`pnpm docker:down` runs `docker compose down -v` and deletes the local database volumes.** A subsequent start then initializes a fresh database. These containers are for local development; Cloudflare deployment is separate.",
    "",
  ];
}
