import { createRequire } from "node:module";
import { resolve } from "node:path";
// Explicitly opt in on this demo only; never include known-password users in generated production seeds.
if (process.env.NORDIX_DEMO_SEED !== "true")
  throw Error("Set NORDIX_DEMO_SEED=true for the playground.");
const base = new URL(process.env.DEMO_APP_URL || "http://localhost:3100");
if (!(base.hostname === "localhost" || base.hostname.startsWith("ai-playground-web-")))
  throw Error("Not a playground destination.");
if (!process.env.DATABASE_URL) throw Error("DATABASE_URL is required.");
const require = createRequire(resolve("apps/api/package.json"));
const { neon } = require("@neondatabase/serverless");
const sql = neon(process.env.DATABASE_URL);
const users = [
  { name: "Demo Reader", email: "reader@nordix.test", password: "DemoReader123!", role: "reader" },
  { name: "Demo Editor", email: "editor@nordix.test", password: "DemoEditor123!", role: "editor" },
];
for (const user of users) {
  if (!(await sql("SELECT id FROM auth_roles WHERE id=$1", [user.role])).length)
    throw Error("Run migrations first.");
  let response = await fetch(new URL("/api/auth/sign-up/email", base), {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: base.origin },
    body: JSON.stringify(user),
  });
  if (!response.ok)
    response = await fetch(new URL("/api/auth/sign-in/email", base), {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: base.origin },
      body: JSON.stringify({ email: user.email, password: user.password }),
    });
  if (!response.ok)
    throw Error(`Cannot provision the explicitly named demo account: ${user.email}`);
  const result = await response.json();
  const changed = await sql(
    "UPDATE auth_user SET role=$1,updated_at=now() WHERE id=$2 AND email=$3 RETURNING id",
    [user.role, result.user.id, user.email],
  );
  if (changed.length !== 1) throw Error("Demo account mismatch.");
  console.log("Demo account ready:", user.email, "role:", user.role);
}
