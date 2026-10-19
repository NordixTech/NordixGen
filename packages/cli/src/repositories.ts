import type { ResolvedProject } from "@nordixgen/core";
import { inside } from "./filesystem.js";
import { type CommandRunner, checkedCommand, safeFailure } from "./process.js";
interface PublicationSettings {
  identity?: { name: string; email: string };
  host: string;
  remotes: ReadonlyMap<string, string>;
}
export async function checkPrerequisites(
  project: ResolvedProject,
  cwd: string,
  runner: CommandRunner,
): Promise<PublicationSettings> {
  await checkedCommand(
    runner,
    "pnpm",
    ["--version"],
    cwd,
    "Package manager preflight failed. Install pnpm before generation",
  );
  let identity: PublicationSettings["identity"];
  if (project.repositories.some((repository) => repository.initializeGit)) {
    await checkedCommand(runner, "git", ["--version"], cwd, "Git preflight failed");
    const name = await checkedCommand(
      runner,
      "git",
      ["config", "--get", "user.name"],
      cwd,
      "Configure a Git user.name before generation",
    );
    const email = await checkedCommand(
      runner,
      "git",
      ["config", "--get", "user.email"],
      cwd,
      "Configure a Git user.email before generation",
    );
    if (!name.trim() || !email.trim())
      throw Error("Configure a nonempty Git user.name and user.email before generation.");
    identity = { name: name.trim(), email: email.trim() };
  }
  const host = (process.env.GH_HOST ?? "github.com").toLowerCase();
  const remotes = new Map<string, string>();
  if (project.repositories.some((repository) => repository.createRemote)) {
    if (!/^[a-z0-9.-]+$/.test(host))
      throw Error("GH_HOST must contain a GitHub hostname, not a URL or credentials.");
    await checkedCommand(
      runner,
      "gh",
      ["auth", "status", "--hostname", host],
      cwd,
      "Authenticate the GitHub CLI before generation",
    );
    for (const repository of project.repositories.filter((repository) => repository.createRemote)) {
      const org = project.organizations.find((org) => org.name === repository.organization);
      if (!org) throw Error("Remote creation requires a resolved organization alias.");
      const slug = `${org.handle}/${repository.name}`;
      await checkedCommand(
        runner,
        "gh",
        ["api", `orgs/${org.handle}`],
        cwd,
        `GitHub organization "${org.handle}" is unavailable`,
      );
      let missing = false;
      try {
        await runner("gh", ["repo", "view", slug, "--json", "nameWithOwner"], cwd);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/404|Could not resolve to a Repository/i.test(message)) missing = true;
        else throw Error(`GitHub repository availability preflight failed: ${safeFailure(error)}`);
      }
      if (!missing)
        throw Error(
          `GitHub repository "${slug}" already exists. Choose a new repository name before generation.`,
        );
      remotes.set(repository.name, slug);
    }
  }
  return { identity, host, remotes };
}
export function remoteMatches(remote: string, host: string, slug: string): boolean {
  const scp = /^git@([^:]+):([^\s]+)$/.exec(remote.trim());
  if (scp)
    return (
      `${scp[1]}/${scp[2].replace(/\.git$/i, "")}`.toLowerCase() === `${host}/${slug}`.toLowerCase()
    );
  try {
    const parsed = new URL(remote.trim());
    return (
      ["https:", "ssh:"].includes(parsed.protocol) &&
      !parsed.password &&
      (!parsed.username || (parsed.protocol === "ssh:" && parsed.username === "git")) &&
      !parsed.search &&
      !parsed.hash &&
      `${parsed.hostname}${parsed.pathname.replace(/\.git$/i, "")}`.toLowerCase() ===
        `${host}/${slug}`.toLowerCase()
    );
  } catch {
    return false;
  }
}
export async function finishRepositories(
  project: ResolvedProject,
  root: string,
  settings: PublicationSettings,
  runner: CommandRunner,
): Promise<void> {
  for (const repository of project.repositories) {
    const directory = inside(root, repository.path);
    const run = (file: string, args: string[], stage: string) =>
      checkedCommand(runner, file, args, directory, `Repository "${repository.name}" ${stage}`);
    if (repository.initializeGit) {
      const identity = settings.identity;
      if (!identity) throw Error("Git identity preflight was not completed.");
      await run("git", ["init", "--initial-branch=main"], "initialization failed");
      await run("git", ["config", "user.name", identity.name], "identity setup failed");
      await run("git", ["config", "user.email", identity.email], "identity setup failed");
      await run("git", ["add", "."], "staging failed");
      await run("git", ["commit", "-m", "Initialize generated project"], "initial commit failed");
      await run("git", ["branch", "develop"], "develop branch creation failed");
    }
    if (repository.createRemote) {
      const slug = settings.remotes.get(repository.name);
      if (!slug) throw Error("Remote publication preflight was not completed.");
      await run(
        "gh",
        [
          "repo",
          "create",
          slug,
          repository.visibility === "public" ? "--public" : "--private",
          "--source",
          ".",
          "--remote",
          "origin",
        ],
        "remote creation failed",
      );
      const remote = await run(
        "git",
        ["remote", "get-url", "origin"],
        "remote verification failed",
      );
      if (!remoteMatches(remote, settings.host, slug))
        throw Error(
          `Repository "${repository.name}" origin does not match its configured GitHub destination. No push was attempted.`,
        );
      const branch = await run(
        "git",
        ["symbolic-ref", "--short", "HEAD"],
        "branch verification failed",
      );
      await run("git", ["check-ref-format", "--branch", branch], "branch verification failed");
      const refs = ["main:refs/heads/main", "develop:refs/heads/develop"];
      await run(
        "git",
        ["push", "--atomic", "--dry-run", "origin", ...refs],
        "push preflight failed",
      );
      await run("git", ["push", "--atomic", "--set-upstream", "origin", ...refs], "push failed");
      await run(
        "gh",
        ["repo", "edit", slug, "--default-branch", "main"],
        "default branch configuration failed",
      );
    }
  }
}
