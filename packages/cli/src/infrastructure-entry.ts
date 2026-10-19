import { runInfrastructureCli } from "./infrastructure-runner.js";
void runInfrastructureCli().catch(() => {
  console.error(
    "Infrastructure operation failed. Check credentials, configuration, state and active builds. No provider output or secrets were printed.",
  );
  process.exitCode = 1;
});
