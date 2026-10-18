import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { open, readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join } from "node:path";

export const images = {
  postgres: "postgres@sha256:742f40ea20b9ff2ff31db5458d127452988a2164df9e17441e191f3b72252193",
  proxy:
    "ghcr.io/timowilhelm/local-neon-http-proxy@sha256:cd2ae14edf2feafbc3330492de5c80506f77274c3bd013154cdef697bdeb768a",
};
export async function command(file, args, cwd, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      cwd,
      env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolve(output)
        : reject(Error(`${file} ${args[0] ?? ""} exited ${code}\n${output}`)),
    );
  });
}
export async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
export async function start(file, args, cwd, env, log) {
  const handle = await open(log, "w");
  try {
    const child = spawn(file, args, {
      cwd,
      env,
      windowsHide: true,
      detached: true,
      stdio: ["ignore", handle.fd, handle.fd],
    });
    child.unref();
    return child;
  } finally {
    await handle.close();
  }
}
export async function ready(url, child) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode)
      throw Error(`Acceptance server exited before ${url} was ready. Inspect its log.`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1500), redirect: "manual" });
      if (response.status < 500) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  throw Error(`Acceptance server did not become ready: ${url}`);
}
export function names(state) {
  return {
    network: `nordixgen-acceptance-${state.id}`,
    database: `nordixgen-acceptance-${state.id}-db`,
    proxy: `nordixgen-acceptance-${state.id}-proxy`,
  };
}
export async function cleanup(state, root) {
  assert.match(state.id, /^[a-f0-9]{16}$/);
  for (const pid of state.pids ?? []) {
    assert.ok(Number.isInteger(pid) && pid > 0);
    let line;
    try {
      line =
        process.platform === "win32"
          ? await command(
              "powershell",
              [
                "-NoProfile",
                "-Command",
                `(Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}').CommandLine`,
              ],
              root,
            )
          : await readFile(`/proc/${pid}/cmdline`, "utf8");
    } catch (error) {
      if (error.code === "ENOENT" || error.code === "ESRCH") continue;
      throw error;
    }
    if (!line.trim()) continue;
    const marker =
      process.platform === "win32"
        ? false
        : (await readFile(`/proc/${pid}/environ`, "utf8"))
            .split("\0")
            .includes(`NORDIXGEN_ACCEPTANCE_STATE=${join(dirname(state.output), "state.json")}`);
    assert.ok(
      line.includes(state.output) || marker,
      "Refusing to stop a process whose acceptance ownership cannot be verified",
    );
    if (process.platform === "win32")
      await command("taskkill", ["/PID", String(pid), "/T", "/F"], root);
    else process.kill(-pid, "SIGTERM");
  }
  const owned = names(state);
  for (const name of [owned.proxy, owned.database]) {
    let inspected;
    try {
      inspected = JSON.parse(await command("docker", ["inspect", name], root))[0];
    } catch (error) {
      if (/No such (object|container)/i.test(error.message)) continue;
      throw error;
    }
    assert.equal(inspected.Name, `/${name}`);
    assert.equal(inspected.Config.Labels["nordixgen-purpose"], "integrated-acceptance");
    assert.equal(inspected.Config.Labels["nordixgen-run"], state.id);
    await command("docker", ["rm", "-f", name], root);
  }
  let network;
  try {
    network = JSON.parse(await command("docker", ["network", "inspect", owned.network], root))[0];
  } catch (error) {
    if (/not found|No such network/i.test(error.message)) return;
    throw error;
  }
  assert.equal(network.Name, owned.network);
  assert.equal(network.Labels["nordixgen-run"], state.id);
  assert.equal(network.Labels["nordixgen-purpose"], "integrated-acceptance");
  await command("docker", ["network", "rm", owned.network], root);
}
