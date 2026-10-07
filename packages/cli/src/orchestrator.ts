import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { intro, isCancel, outro, select, text } from "@clack/prompts";
import {
  type NordixConfig,
  normalizeBackends,
  normalizeFrontends,
  parseNordixYaml,
} from "@nordixgen/core";
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
): Promise<void> {
  const framework = application.framework.toLowerCase();
  if (framework === "nextjs" || framework === "next.js") {
    await runner(
      "pnpm",
      [
        "dlx",
        "create-next-app@15.1.7",
        basename(target),
        "--yes",
        "--typescript",
        "--app",
        "--tailwind",
        "--use-pnpm",
        "--skip-install",
        "--disable-git",
      ],
      dirname(target),
    );
    return;
  }
  if (framework === "hono") {
    await runner(
      "pnpm",
      [
        "create",
        "cloudflare@2.72.13",
        basename(target),
        "--framework=hono",
        "--lang=ts",
        "--no-deploy",
        "--no-git",
        "--accept-defaults",
      ],
      dirname(target),
    );
    return;
  }
  throw new Error(
    `Unsupported framework "${application.framework}" for "${application.name}". Phase 3 supports Next.js and Hono scaffolding.`,
  );
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

  for (const app of applications) {
    if (!["nextjs", "next.js", "hono"].includes(app.framework.toLowerCase())) {
      throw new Error(
        `Unsupported framework "${app.framework}" for "${app.name}". Phase 3 supports Next.js and Hono scaffolding.`,
      );
    }
    const repo = repositories.find((item) => item.name === app.repository);
    if (!repo) throw new Error(`Application "${app.name}" references an unknown repository.`);
    safeResolve(repo.root, app.path);
  }
  for (const repository of repositories) await assertEmptyOrMissing(repository.root);

  await mkdir(target, { recursive: true });
  for (const repository of repositories) await mkdir(repository.root, { recursive: true });

  for (const app of applications) {
    const repo = repositories.find((item) => item.name === app.repository);
    if (!repo) throw new Error(`Application "${app.name}" references an unknown repository.`);
    const appTarget = safeResolve(repo.root, app.path);
    await mkdir(dirname(appTarget), { recursive: true });
    await scaffold(app, appTarget, runner);
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

    if (!hasRootApplication) {
      await writeFile(
        join(repository.root, "README.md"),
        `# ${repository.name}\n\nGenerated by NordixGen.\n`,
        "utf8",
      );
    }

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
