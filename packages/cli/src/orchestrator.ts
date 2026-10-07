import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { intro, isCancel, outro, select, text } from "@clack/prompts";
import {
  type FrameworkContext,
  type NordixConfig,
  type PluginCompositionResult,
  PluginRegistry,
  cleanArchitecturePlugin,
  composeBackendPlugins,
  drizzleOrmPlugin,
  honoFrameworkPlugin,
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
  frameworkContext?: FrameworkContext,
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
        "--src-dir",
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
    if (!frameworkContext) {
      throw new Error(`Framework context for Hono is missing for "${application.name}".`);
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
    `Unsupported framework "${application.framework}" for "${application.name}". Phase 3 supports Next.js and Hono scaffolding.`,
  );
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

async function writeBrandedNextHomepage(
  applicationRoot: string,
  projectName: string,
  frontendName: string,
): Promise<void> {
  const appDirectory = join(applicationRoot, "src", "app");
  await mkdir(appDirectory, { recursive: true });
  const source = `export const metadata = {
  title: "${projectName} | NordixGen",
  description: "A full-stack foundation for ${projectName}, generated with NordixGen.",
};

export default function Home() {
  return (
    <main className="relative isolate min-h-screen overflow-hidden bg-[#080b12] text-slate-100">
      <div aria-hidden="true" className="pointer-events-none absolute -left-40 -top-40 h-96 w-96 rounded-full bg-cyan-400/10 blur-3xl" />
      <div aria-hidden="true" className="pointer-events-none absolute -bottom-48 right-0 h-[32rem] w-[32rem] rounded-full bg-indigo-500/10 blur-3xl" />
      <header className="relative mx-auto flex max-w-7xl items-center justify-between px-6 py-7 lg:px-10">
        <a aria-label="NordixGen home" className="flex items-center gap-3" href="#top">
          <span className="grid h-10 w-10 place-items-center rounded-xl border border-cyan-200/20 bg-cyan-300/10 text-lg font-semibold text-cyan-200">N</span>
          <span className="text-lg font-semibold tracking-tight">Nordix<span className="text-cyan-300">Gen</span></span>
        </a>
        <span className="hidden rounded-full border border-white/10 px-4 py-2 text-xs font-medium tracking-[0.2em] text-slate-400 sm:inline-flex">PROJECT STARTER</span>
      </header>

      <section id="top" className="relative mx-auto grid min-h-[78vh] max-w-7xl items-center gap-16 px-6 py-16 lg:grid-cols-[1.2fr_0.8fr] lg:px-10">
        <div>
          <p className="mb-7 flex items-center gap-3 text-xs font-semibold tracking-[0.24em] text-cyan-200">
            <span aria-hidden="true" className="h-2 w-2 rounded-full bg-cyan-300 shadow-[0_0_18px_rgba(103,232,249,0.9)]" />
            BUILT WITH NORDIXGEN
          </p>
          <h1 className="max-w-3xl text-5xl font-semibold leading-[1.05] tracking-tight sm:text-7xl">
            A new foundation<br />
            <span className="bg-gradient-to-r from-cyan-200 via-sky-300 to-indigo-300 bg-clip-text text-transparent">for ${projectName}.</span>
          </h1>
          <p className="mt-7 max-w-xl text-lg leading-8 text-slate-400">Your architecture is ready to become a product. Start with a clean foundation, then make it unmistakably yours.</p>
          <a className="mt-10 inline-flex items-center gap-3 rounded-full bg-cyan-200 px-6 py-3 font-semibold text-slate-950 transition hover:bg-white" href="#project">
            Explore your project <span aria-hidden="true">↓</span>
          </a>
        </div>

        <aside id="project" className="rounded-3xl border border-white/10 bg-white/[0.035] p-7 shadow-2xl shadow-cyan-950/20 backdrop-blur sm:p-9">
          <div className="flex items-center justify-between border-b border-white/10 pb-6">
            <div>
              <p className="text-xs font-semibold tracking-[0.2em] text-slate-500">PROJECT OVERVIEW</p>
              <p className="mt-2 text-xl font-semibold">Your next chapter starts here.</p>
            </div>
            <span aria-hidden="true" className="text-2xl text-cyan-200">✦</span>
          </div>
          <dl className="divide-y divide-white/10">
            <div className="flex items-center justify-between gap-4 py-5">
              <dt className="text-sm text-slate-500">Project</dt>
              <dd className="font-medium">${projectName}</dd>
            </div>
            <div className="flex items-center justify-between gap-4 py-5">
              <dt className="text-sm text-slate-500">Frontend</dt>
              <dd className="font-medium">${frontendName}</dd>
            </div>
            <div className="flex items-center justify-between gap-4 py-5">
              <dt className="text-sm text-slate-500">Created with</dt>
              <dd className="font-medium text-cyan-200">NordixGen</dd>
            </div>
          </dl>
          <p className="mt-2 rounded-2xl bg-black/20 px-4 py-3 text-sm leading-6 text-slate-400">This is your starting point. The next phases will generate features from your entities and endpoints.</p>
        </aside>
      </section>

      <footer className="relative mx-auto flex max-w-7xl flex-col gap-2 border-t border-white/10 px-6 py-6 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between lg:px-10">
        <span>Made with care by NordixGen.</span>
        <span className="tracking-[0.16em]">BUILD SOMETHING GREAT</span>
      </footer>
    </main>
  );
}
`;
  await writeFile(join(appDirectory, "page.tsx"), source, "utf8");
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
  const pluginRegistry = new PluginRegistry();
  pluginRegistry.register(honoFrameworkPlugin);
  pluginRegistry.register(cleanArchitecturePlugin);
  pluginRegistry.register(drizzleOrmPlugin);

  for (const app of applications) {
    if (!["nextjs", "next.js", "hono"].includes(app.framework.toLowerCase())) {
      throw new Error(
        `Unsupported framework "${app.framework}" for "${app.name}". Phase 3 supports Next.js and Hono scaffolding.`,
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
    await scaffold(app, appTarget, runner, composition?.frameworkContext);
    if (composition) await composition.virtualFileSystem.emit(repo.root);
    if (app.kind === "frontend" && ["nextjs", "next.js"].includes(app.framework.toLowerCase())) {
      await writeBrandedNextHomepage(appTarget, config.name, app.name);
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
