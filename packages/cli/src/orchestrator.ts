import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { intro, isCancel, outro, select, text } from "@clack/prompts";
import {
  type FrameworkContext,
  FrontendPluginRegistry,
  type NordixConfig,
  type PluginCompositionResult,
  PluginRegistry,
  betterAuthFrontendPlugin,
  betterAuthPlugin,
  buildFrontendApiContract,
  cleanArchitecturePlugin,
  composeBackendPlugins,
  composeFrontendPlugins,
  contextClientStatePlugin,
  drizzleOrmPlugin,
  honoFrameworkPlugin,
  nativeReactUiPlugin,
  nextjsFrontendPlugin,
  normalizeBackends,
  normalizeFrontends,
  parseNordixYaml,
  plainCssStylingPlugin,
  rbacPbacPlugin,
  swrServerStatePlugin,
  tailwindStylingPlugin,
  tanstackQueryServerStatePlugin,
  typedFetchApiPlugin,
  zustandClientStatePlugin,
} from "@nordixgen/core";
import { applyEdits, modify, parse } from "jsonc-parser";
import pc from "picocolors";
import { type CommandRunner, runCommand } from "./process.js";

const CONFIG_FILE = "nordix.config.yaml";

export function createStarterConfiguration(name: string, includeFrontend: boolean): string {
  if (!/^[a-z][a-z0-9-]*$/.test(name)) {
    throw new Error(
      "Project name must use lowercase letters, digits, and hyphens and start with a letter.",
    );
  }
  return [
    `name: ${name}`,
    "version: 1.0.0",
    "repositories:",
    "  - name: app",
    "    path: .",
    "    initializeGit: false",
    "    createRemote: false",
    "backends:",
    "  - name: api",
    "    framework: hono",
    "    repository: app",
    "    path: apps/api",
    "    auth:",
    "      type: none",
    ...(includeFrontend
      ? [
          "frontends:",
          "  - name: web",
          "    framework: nextjs",
          "    type: web",
          "    styling: tailwind",
          "    ui: native",
          "    repository: app",
          "    connectsTo: [api]",
          "    path: apps/web",
        ]
      : []),
    "entities:",
    "  Example:",
    "    backend: api",
    "    fields:",
    "      name:",
    "        type: string",
    "        required: true",
    "    timestamps:",
    "      createdAt: true",
    "      updatedAt: true",
    "    softDelete: false",
    "endpoints: []",
    "",
  ].join("\n");
}
export async function runInit(): Promise<void> {
  intro(pc.cyan("Create a NordixGen project"));
  const name = await text({
    message: "Project name",
    placeholder: "my-project",
    validate: (value) =>
      /^[a-z][a-z0-9-]*$/.test(value)
        ? undefined
        : "Use lowercase letters, digits, and hyphens; start with a letter.",
  });
  if (isCancel(name)) {
    outro("Setup cancelled.");
    return;
  }
  if (typeof name !== "string") throw new Error("Project name was not provided.");

  const framework = await select({
    message: "Choose the initial backend",
    options: [{ value: "hono", label: "Hono on Cloudflare Workers" }],
  });
  if (isCancel(framework)) {
    outro("Setup cancelled.");
    return;
  }

  const includeFrontend = await select({
    message: "Include a Next.js frontend?",
    options: [
      { value: true, label: "Yes" },
      { value: false, label: "No" },
    ],
  });
  if (isCancel(includeFrontend)) {
    outro("Setup cancelled.");
    return;
  }
  if (typeof includeFrontend !== "boolean") throw new Error("Frontend selection was not provided.");

  const config = createStarterConfiguration(name, includeFrontend);
  const output = await text({
    message: `Path for ${CONFIG_FILE}`,
    placeholder: CONFIG_FILE,
    defaultValue: CONFIG_FILE,
  });
  if (isCancel(output)) {
    outro("Setup cancelled.");
    return;
  }

  const path = resolve(String(output));
  try {
    await access(path);
    throw new Error(`File already exists: ${path}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const parsed = parseNordixYaml(config);
  if (!parsed.success) {
    throw new Error(
      `Internal error: invalid starter config: ${parsed.diagnostics.map((item) => item.message).join("; ")}`,
    );
  }

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, config, { encoding: "utf8", flag: "wx" });
  outro(`Created ${path}`);
}

function validateOwnerHandle(handle: string): string {
  if (!/^[A-Za-z0-9-]+$/.test(handle)) {
    throw new Error(`Invalid GitHub account or organization handle: ${handle}`);
  }
  return handle;
}

async function preflightGitHub(
  config: NordixConfig,
  cwd: string,
  runner: CommandRunner,
): Promise<void> {
  const remotes = config.repositories.filter((repository) => repository.createRemote);
  if (remotes.length === 0) return;

  await runner("gh", ["auth", "status", "--active", "--hostname", "github.com"], cwd).catch(() => {
    throw new Error(
      "GitHub CLI is not authenticated. Install `gh`, then run `gh auth login` and retry.",
    );
  });
  const login = await runner("gh", ["api", "user", "--jq", ".login"], cwd);

  for (const repository of remotes) {
    const ownerConfig = config.organizations.find(
      (entry) => entry.name === repository.organization,
    );
    if (!ownerConfig || ownerConfig.provider !== "github") {
      throw new Error(
        `Remote creation for repository "${repository.name}" currently supports GitHub only. Configure a GitHub owner or keep createRemote: false.`,
      );
    }

    const handle = validateOwnerHandle(ownerConfig.handle);
    const response = await runner(
      "gh",
      [
        "api",
        "graphql",
        "-f",
        `query=query { organization(login: "${handle}") { login viewerCanCreateRepositories } user(login: "${handle}") { login } }`,
      ],
      cwd,
    );

    let data: {
      data?: {
        organization?: { login: string; viewerCanCreateRepositories: boolean } | null;
        user?: { login: string } | null;
      };
    };
    try {
      data = JSON.parse(response);
    } catch {
      throw new Error(`Could not verify repository creation access for GitHub owner "${handle}".`);
    }

    if (data.data?.organization === null && data.data.user) {
      if (login.toLowerCase() !== handle.toLowerCase()) {
        throw new Error(
          `Authenticated GitHub account is "${login}", but personal repository "${repository.name}" targets "${handle}". Run gh auth switch or gh auth login with the intended account.`,
        );
      }
    } else if (!data.data?.organization?.viewerCanCreateRepositories) {
      throw new Error(
        `Authenticated account "${login}" cannot create repositories in organization "${handle}" (or the organization is inaccessible). Ask an owner for permission, then retry.`,
      );
    }

    const exists = await runner(
      "gh",
      ["api", `repos/${handle}/${repository.name}`, "--jq", ".full_name"],
      cwd,
    )
      .then(() => true)
      .catch((error: Error) => {
        if (/HTTP 404|Not Found|gh: Not Found/i.test(error.message)) return false;
        throw new Error(
          `Could not verify whether ${handle}/${repository.name} already exists: ${error.message}`,
        );
      });
    if (exists) {
      throw new Error(
        `Remote repository ${handle}/${repository.name} already exists. Choose a different repository name.`,
      );
    }
  }
}

function safeResolve(root: string, path: string): string {
  if (path.includes("\\") || path.split("/").includes("..") || isAbsolute(path)) {
    throw new Error(`Unsafe output path: ${path}`);
  }
  const resolved = resolve(root, ...path.split("/").filter((part) => part && part !== "."));
  const rel = relative(root, resolved);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`Output path escapes target directory: ${path}`);
  }
  return resolved;
}

async function assertEmptyOrMissing(target: string): Promise<void> {
  try {
    const entries = await readdir(target);
    if (entries.length > 0) throw new Error(`Target directory must be empty: ${target}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

async function scaffold(
  application: { name: string; framework: string },
  target: string,
  runner: CommandRunner,
  frameworkContext?: FrameworkContext | { scaffold: FrameworkContext["scaffold"] },
): Promise<void> {
  const framework = application.framework.toLowerCase();
  if (framework === "nextjs" || framework === "next.js" || framework === "hono") {
    if (!frameworkContext) {
      throw new Error(`Framework context for "${application.name}" is missing.`);
    }
    const plan = frameworkContext.scaffold;
    await runner(
      plan.executable,
      [...plan.argumentsBeforeTarget, basename(target), ...plan.argumentsAfterTarget],
      dirname(target),
    );
    return;
  }
  throw new Error(
    `Unsupported framework "${application.framework}" for "${application.name}". Register a framework plugin before generation.`,
  );
}

async function installCompositionDependencies(
  applicationRoot: string,
  dependencies: Readonly<Record<string, string>>,
  runner: CommandRunner,
): Promise<void> {
  const manifestPath = join(applicationRoot, "package.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    scripts?: Record<string, string>;
  };
  const updated = { ...manifest.dependencies };
  const updatedDevDependencies = { ...manifest.devDependencies };
  let changed = false;
  for (const [name, version] of Object.entries(dependencies)) {
    if (updated[name] === version) continue;
    updated[name] = version;
    changed = true;
  }
  const developmentDependencies = {
    "@types/node": "^24.0.0",
    tsx: "^4.20.6",
    typescript: "^5.8.2",
  };
  for (const [name, version] of Object.entries(developmentDependencies)) {
    if (updatedDevDependencies[name] === version) continue;
    updatedDevDependencies[name] = version;
    changed = true;
  }
  const scripts = {
    ...manifest.scripts,
    build: "tsc --noEmit",
    typecheck: "tsc --noEmit",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "tsx src/infrastructure/database/migrate.ts",
    "db:seed": "tsx src/infrastructure/database/seed.ts",
  };
  for (const [name, command] of Object.entries(scripts)) {
    if (manifest.scripts?.[name] === command) continue;
    changed = true;
  }
  if (!changed) return;
  manifest.dependencies = updated;
  manifest.devDependencies = updatedDevDependencies;
  manifest.scripts = scripts;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await runner("pnpm", ["install"], applicationRoot);
}

async function installFrontendPluginDependencies(
  applicationRoot: string,
  dependencies: Readonly<Record<string, string>>,
  developmentDependencies: Readonly<Record<string, string>>,
  runner: CommandRunner,
): Promise<void> {
  if (Object.keys(dependencies).length === 0 && Object.keys(developmentDependencies).length === 0)
    return;
  const manifestPath = join(applicationRoot, "package.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const updatedDependencies = { ...manifest.dependencies };
  const updatedDevelopmentDependencies = { ...manifest.devDependencies };
  let changed = false;
  for (const [name, version] of Object.entries(dependencies)) {
    if (updatedDependencies[name] === version) continue;
    updatedDependencies[name] = version;
    changed = true;
  }
  for (const [name, version] of Object.entries(developmentDependencies)) {
    if (updatedDevelopmentDependencies[name] === version) continue;
    updatedDevelopmentDependencies[name] = version;
    changed = true;
  }
  if (!changed) return;
  manifest.dependencies = updatedDependencies;
  manifest.devDependencies = updatedDevelopmentDependencies;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await runner("pnpm", ["install"], applicationRoot);
}

async function writeNordixReadme(
  repositoryRoot: string,
  projectName: string,
  repositoryName: string,
  applications: Array<{ name: string; framework: string; path: string }>,
): Promise<void> {
  const readmePath = join(repositoryRoot, "README.md");
  let frameworkReadme = "";
  try {
    frameworkReadme = await readFile(readmePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const appList = applications.length
    ? applications
        .map(
          (application) =>
            `| ${application.name} | ${application.framework} | \`${application.path}\` |`,
        )
        .join("\n")
    : "| No applications assigned | — | — |";
  const quickStart = applications.length
    ? "\n## Start developing\n\n```sh\npnpm install\npnpm dev\n```\n"
    : "";
  const frameworkSection = frameworkReadme.trim()
    ? `\n<details>\n<summary>Original framework starter guide</summary>\n\n${frameworkReadme.trim()}\n\n</details>\n`
    : "";

  const content = `# ✦ NordixGen\n\n> **${projectName}** — a full-stack foundation shaped by your architecture.\n\nGenerated with **NordixGen**. Your apps are scaffolded from the official framework tools and organized in the \`${repositoryName}\` repository.\n\n## Applications\n\n| App | Framework | Path |\n| --- | --- | --- |\n${appList}\n${quickStart}${frameworkSection}\n`;
  await writeFile(readmePath, content, "utf8");
}

export async function runGenerate(
  file: string,
  output: string,
  runner: CommandRunner = runCommand,
): Promise<void> {
  const configResult = parseNordixYaml(await readFile(resolve(file), "utf8"));
  if (!configResult.success) {
    throw new Error(
      configResult.diagnostics
        .map((item) => `${item.code} at ${item.path}: ${item.message}`)
        .join("\n"),
    );
  }
  const config = configResult.config;
  const target = resolve(output);
  await assertEmptyOrMissing(target);
  await preflightGitHub(config, process.cwd(), runner);

  for (const repository of config.repositories.filter((item) => item.initializeGit)) {
    await runner("git", ["var", "GIT_COMMITTER_IDENT"], process.cwd()).catch(() => {
      throw new Error(
        `Repository "${repository.name}" requests initializeGit, but Git user.name/user.email are not configured. Run git config --global user.name and git config --global user.email, then retry.`,
      );
    });
  }

  const repositories = config.repositories.map((repo) => ({
    ...repo,
    root: safeResolve(target, repo.path),
  }));
  const applications = [
    ...normalizeFrontends(config).map((app) => ({ ...app, kind: "frontend" as const })),
    ...normalizeBackends(config).map((app) => ({ ...app, kind: "backend" as const })),
  ];
  const backendCompositions = new Map<
    string,
    Extract<PluginCompositionResult, { success: true }>
  >();
  const frontendCompositions = new Map<
    string,
    Extract<ReturnType<typeof composeFrontendPlugins>, { success: true }>
  >();
  const pluginRegistry = new PluginRegistry();
  pluginRegistry.register(honoFrameworkPlugin);
  pluginRegistry.register(cleanArchitecturePlugin);
  pluginRegistry.register(drizzleOrmPlugin);
  pluginRegistry.register(betterAuthPlugin);
  pluginRegistry.register(rbacPbacPlugin);
  const frontendPluginRegistry = new FrontendPluginRegistry();
  frontendPluginRegistry.register(nextjsFrontendPlugin);
  frontendPluginRegistry.register(tailwindStylingPlugin);
  frontendPluginRegistry.register(plainCssStylingPlugin);
  frontendPluginRegistry.register(nativeReactUiPlugin);
  frontendPluginRegistry.register(typedFetchApiPlugin);
  frontendPluginRegistry.register(tanstackQueryServerStatePlugin);
  frontendPluginRegistry.register(swrServerStatePlugin);
  frontendPluginRegistry.register(zustandClientStatePlugin);
  frontendPluginRegistry.register(contextClientStatePlugin);
  frontendPluginRegistry.register(betterAuthFrontendPlugin);

  for (const app of applications) {
    if (app.kind === "backend" && app.framework.toLowerCase() !== "hono") {
      throw new Error(
        `Unsupported backend framework "${app.framework}" for "${app.name}". Register a backend framework plugin before generation.`,
      );
    }
    const repo = repositories.find((item) => item.name === app.repository);
    if (!repo) throw new Error(`Application "${app.name}" references an unknown repository.`);
    safeResolve(repo.root, app.path);
    if (app.kind === "backend" && app.framework.toLowerCase() === "hono") {
      const composition = composeBackendPlugins(config, app.name, pluginRegistry);
      if (!composition.success) {
        throw new Error(
          composition.diagnostics
            .map((item) => `${item.code} at ${item.path}: ${item.message}`)
            .join("\n"),
        );
      }
      backendCompositions.set(app.name, composition);
    } else if (app.kind === "frontend") {
      const api = buildFrontendApiContract(config, app);
      const composition = composeFrontendPlugins(config.name, app, frontendPluginRegistry, api);
      if (!composition.success) {
        throw new Error(
          composition.diagnostics
            .map((item) => `${item.code} at ${item.path}: ${item.message}`)
            .join("\n"),
        );
      }
      frontendCompositions.set(app.name, composition);
    }
  }
  for (const repository of repositories) await assertEmptyOrMissing(repository.root);

  await mkdir(target, { recursive: true });
  for (const repository of repositories) await mkdir(repository.root, { recursive: true });

  for (const app of applications) {
    const repo = repositories.find((item) => item.name === app.repository);
    if (!repo) throw new Error(`Application "${app.name}" references an unknown repository.`);
    const appTarget = safeResolve(repo.root, app.path);
    await mkdir(dirname(appTarget), { recursive: true });
    const composition = app.kind === "backend" ? backendCompositions.get(app.name) : undefined;
    const frontendComposition =
      app.kind === "frontend" ? frontendCompositions.get(app.name) : undefined;
    await scaffold(
      app,
      appTarget,
      runner,
      composition?.frameworkContext ?? frontendComposition?.frameworkContext,
    );
    if (app.kind === "backend" && app.authentication?.plugin === "better-auth") {
      await enableHonoAuthenticationRuntime(appTarget);
    }
    if (composition) {
      await composition.virtualFileSystem.emit(repo.root);
      await installCompositionDependencies(appTarget, composition.runtimeDependencies, runner);
    }
    if (frontendComposition) {
      await frontendComposition.virtualFileSystem.emit(repo.root);
      await installFrontendPluginDependencies(
        appTarget,
        frontendComposition.runtimeDependencies,
        frontendComposition.developmentDependencies,
        runner,
      );
    }
  }

  for (const repository of repositories) {
    const apps = applications.filter((app) => app.repository === repository.name);
    const hasRootApplication = apps.some((app) => app.path === ".");

    if (apps.length > 1 || apps.some((app) => app.path !== ".")) {
      const workspace = apps.map((app) => `  - '${app.path.replace(/\/$/, "")}'`).join("\n");
      await writeFile(
        join(repository.root, "pnpm-workspace.yaml"),
        `packages:\n${workspace}\n`,
        "utf8",
      );
      if (!hasRootApplication) {
        await writeFile(
          join(repository.root, "package.json"),
          `${JSON.stringify(
            {
              name: repository.name,
              private: true,
              packageManager: "pnpm@10.5.2",
              scripts: {
                dev: "pnpm --parallel --recursive dev",
                build: "pnpm --recursive build",
                test: "pnpm --recursive test",
              },
            },
            null,
            2,
          )}\n`,
          "utf8",
        );
      }
    }

    await writeNordixReadme(repository.root, config.name, repository.name, apps);

    if (repository.initializeGit) {
      await runner("git", ["init"], repository.root);
      await runner("git", ["add", "--all"], repository.root);
      await runner("git", ["commit", "-m", "chore: initialize generated project"], repository.root);
    }

    if (repository.createRemote) {
      const organization = config.organizations.find(
        (entry) => entry.name === repository.organization,
      );
      if (!organization) {
        throw new Error(`Repository "${repository.name}" references an unknown organization.`);
      }
      const owner = validateOwnerHandle(organization.handle);
      const args = [
        "repo",
        "create",
        `${owner}/${repository.name}`,
        repository.visibility === "public" ? "--public" : "--private",
      ];
      if (repository.initializeGit) args.push("--source", repository.root, "--remote", "origin");
      await runner("gh", args, repository.root);

      if (repository.initializeGit) {
        const remoteUrl = await runner("git", ["remote", "get-url", "origin"], repository.root);
        const expectedRemote = `${owner}/${repository.name}`.toLowerCase();
        if (
          !remoteUrl
            .toLowerCase()
            .replace(/\.git$/, "")
            .includes(expectedRemote)
        ) {
          throw new Error(
            `Configured origin does not match ${owner}/${repository.name}; refusing to push.`,
          );
        }
        try {
          await runner("git", ["push", "--dry-run", "origin", "HEAD"], repository.root);
        } catch (error) {
          throw new Error(
            `GitHub created ${owner}/${repository.name}, but the push preflight failed and no commit was pushed. Check repository write access, organization SSO/token authorization, and branch rules. ${error instanceof Error ? error.message : String(error)}`,
          );
        }
        await runner("git", ["push", "--set-upstream", "origin", "HEAD"], repository.root);
      }
    }
  }
  outro(`Generated ${config.name} in ${target}`);
}

async function enableHonoAuthenticationRuntime(applicationRoot: string): Promise<void> {
  const configurationPath = join(applicationRoot, "wrangler.jsonc");
  let source: string;
  try {
    source = await readFile(configurationPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    throw new Error(
      "Hono scaffolding did not create wrangler.jsonc. Better Auth requires the Cloudflare Workers nodejs_compat flag; generation stopped before writing project files.",
    );
  }

  const parseErrors: { error: number; offset: number; length: number }[] = [];
  const configuration: unknown = parse(source, parseErrors, {
    allowTrailingComma: true,
    disallowComments: false,
  });
  if (parseErrors.length > 0 || typeof configuration !== "object" || configuration === null) {
    throw new Error(
      "Could not safely update wrangler.jsonc for Better Auth. Fix the scaffold's JSONC configuration and retry.",
    );
  }

  const currentFlags = (configuration as Record<string, unknown>).compatibility_flags;
  if (
    currentFlags !== undefined &&
    (!Array.isArray(currentFlags) || !currentFlags.every((flag) => typeof flag === "string"))
  ) {
    throw new Error('wrangler.jsonc "compatibility_flags" must be an array of strings.');
  }
  const flags = [...new Set([...((currentFlags as string[] | undefined) ?? []), "nodejs_compat"])];
  if (flags.length === (currentFlags as string[] | undefined)?.length) return;

  const edits = modify(source, ["compatibility_flags"], flags, {
    formattingOptions: { insertSpaces: true, tabSize: 2 },
  });
  await writeFile(configurationPath, applyEdits(source, edits), "utf8");
}
