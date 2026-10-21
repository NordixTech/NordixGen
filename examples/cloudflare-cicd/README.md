# Cloudflare + Neon CI/CD example

A small public application for trying account setup: Hono API, a dedicated Neon database resource, Next.js/OpenNext frontend, an Example list/create screen at `/example`, and separate staging/production deployments. There is deliberately no login requirement, so the first deployment can use the proposed `workers.dev` URLs without a custom domain. Existing Better Auth generation is unchanged; authenticated apps use the same-origin routing instructions in the generated deployment guide.

## Generate

From the NordixGen checkout, use Node.js 24 and pnpm 10.5.2:

```sh
pnpm install --frozen-lockfile
pnpm build
node packages/cli/dist/index.js generate -f examples/cloudflare-cicd/project.yaml -o tmp/cloudflare-cicd-demo
```

The new repository contains an initial commit on `main` and `develop` starting at the same commit. It has installed dependencies and passed application type/boundary checks. Generation does not create cloud resources or a remote.

## Try setup

From the generated repository root, create a private GitHub repository if it does not already have a remote:

```sh
gh repo create YOUR_OWNER/nordix-cicd-demo --private --source . --remote origin
git push --atomic --set-upstream origin main develop
gh repo edit YOUR_OWNER/nordix-cicd-demo --default-branch main
```

Then read `docs/DEPLOYMENT.md` for the one-time GitHub App authorization and build-token prerequisites. Choose either:

1. **Assistant:** run `pnpm cicd:setup`. Select the Cloudflare account and build token, accept or edit the proposed origins, and choose an existing Neon project or create a new one by selecting organization and region. Tokens are masked prompts or local shell environment variables. Use a new Neon project for this example.
2. **Manual:** follow the generated `docs/DEPLOYMENT.md`. It lists the Neon branches, runtime/build secrets, native Git connection and exact per-application commands. No GitHub Actions runners are needed.

After setup, push a real file change to `develop`. Wait for the two Cloudflare staging builds to finish, open the staging frontend at `/example` and create a record. Merge into `main`, push, and wait for production's two builds. Its list must not contain the staging record. A branch's native builds may queue on Cloudflare Free, which runs one build at a time.

To check another account, run `pnpm cicd:setup --profile other-client`. The assistant saves only public destination metadata in ignored `.nordixgen/`; it does not move existing database data, custom domains or old triggers. The deployment guide explains account changes and cleanup. Never commit credentials or generated local profiles.

## Verified workflow

The issue 101 implementation was exercised with a separate generated project before preparing the user example: Neon project and staging creation, repeated setup without duplicate branches/triggers, native builds originating from real GitHub pushes on `develop` and `main`, backend migrations, live frontend browser writes, and database isolation. Unit/type checks and Docker browser/database/auth acceptance cover both monorepo and split layouts. This example uses that verified public topology; the user's fresh generated copy starts without cloud connections so setup can be tried independently.

For recovery, follow the generated `docs/DISASTER_RECOVERY.md`. Restore retention depends on plan; RPO/RTO goals require a separate measured rehearsal. No off-site backups or Neon Managed Auth are configured.
