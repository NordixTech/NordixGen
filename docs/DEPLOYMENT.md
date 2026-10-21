# Generated Cloudflare deployment

Generated repositories include a standalone `pnpm cicd:setup` assistant and a project-specific `DEPLOYMENT.md`. Setup connects the GitHub repository to native Cloudflare Workers Builds, creates staging/production Workers and persistent Neon branches, and configures build/runtime secrets. No GitHub Actions workflow is generated.

Pushes to `develop` build staging; pushes to `main` build production. Each frontend/backend has its own native build trigger. Cloudflare checks out the triggering revision in a build container, runs the generated build command and then deploys the Worker. The application Worker itself does not pull Git or run CI.

Frontends use Next.js/OpenNext on Workers. Backends are Workers with public workers.dev and preview URLs disabled. Frontend browser calls use same-origin `/api/backend/<backend>`, `/api/auth` and `/api/auth/iam` routes; server calls use explicit service bindings. Authentication remains in the selected backend. Cloud execution has no public HTTP fallback. Local Docker explicitly opts into internal bridge URLs.

When R2 infrastructure is declared, the build first applies OpenTofu changes and synchronizes bindings. See [infrastructure lifecycle and permissions](INFRASTRUCTURE.md). Existing deployment behavior remains available for projects without infrastructure. Database migrations use committed SQL; Neon PITR remains covered by each generated `DISASTER_RECOVERY.md`.

Verify both environments after setup: frontend renders, backend health works through the frontend proxy, backend public URLs deny access, business requests reach the correct database, sessions survive protected server navigation, logout revokes access, and storage supports authenticated and signed downloads. Keep production/staging auth secrets separate and keep all keys out of Git and screenshots.
