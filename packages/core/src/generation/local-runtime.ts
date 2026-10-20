import type { BackendRenderContext, GeneratedFile } from "../plugins/contracts.js";

/** A local Node adapter; the Cloudflare Worker entry point remains independently usable. */
export function generateLocalRuntime(context: BackendRenderContext): readonly GeneratedFile[] {
  return [
    {
      path: `${context.framework.codeRoot}/local-server.ts`,
      content: `import {serve} from "@hono/node-server";
import app from "./index.js";
${
  context.domainModel.backend.storage.length
    ? `import {Miniflare} from "miniflare";
const emulator=new Miniflare({modules:true,script:'export default {fetch(){return new Response(null,{status:404})}}',r2Buckets:${JSON.stringify(Object.fromEntries(context.domainModel.backend.storage.map((key) => [key.toUpperCase(), `${context.projectName}-${key}`])))},r2Persist:process.env.R2_LOCAL_PERSIST??".local/r2"});
const storageBindings=await emulator.getBindings();
`
    : ""
}
${context.persistence ? 'import {prepareLocalDatabase} from "./platform/database/local-bootstrap.js";\nawait prepareLocalDatabase();' : ""}
const server=serve({hostname:"0.0.0.0",port:Number(process.env.PORT??8787),fetch(request,bindings){
 if(!request.headers.has("x-nordix-client-ip"))request.headers.set("x-nordix-client-ip",bindings.incoming.socket.remoteAddress??"127.0.0.1");
 return app.fetch(request,${context.domainModel.backend.storage.length ? "{...process.env,...storageBindings}" : "process.env"} as Parameters<typeof app.fetch>[1],{
  waitUntil(promise:Promise<unknown>){void promise.catch(console.error);},
  passThroughOnException(){},props:{},
 } as Parameters<typeof app.fetch>[2]);
}});
for(const signal of ["SIGTERM","SIGINT"] as const)process.on(signal,()=>{server.close(()=>process.exit(0));});
`,
    },
    {
      path: `${context.framework.applicationRoot}/scripts/build-local.mjs`,
      content: `import {readdir} from "node:fs/promises";
import {join} from "node:path";
import {build} from "esbuild";
async function sources(directory){
 const entries=await readdir(directory,{withFileTypes:true});
 return (await Promise.all(entries.map(entry=>entry.isDirectory()?sources(join(directory,entry.name)):entry.name.endsWith(".ts")&&!entry.name.endsWith(".d.ts")?[join(directory,entry.name)]:[]))).flat();
}
// Preserve module boundaries and import.meta.url for migration tooling.
await build({entryPoints:await sources("src"),outbase:"src",outdir:".docker-dist",platform:"node",format:"esm",target:"node24"});
`,
    },
    ...(context.persistence
      ? [
          {
            path: `${context.platformRoot}/database/local-bootstrap.ts`,
            content: `import {fileURLToPath} from "node:url";
import {createDrizzleDatabase} from "./drizzle-database.js";
import {runMigrations} from "./migrate.js";
import {seedDatabase} from "./seed.js";
import {sql} from "drizzle-orm";
export async function prepareLocalDatabase():Promise<void>{
 await runMigrations({directory:fileURLToPath(new URL("../../../drizzle/",import.meta.url))});
 const db=createDrizzleDatabase(process.env.DATABASE_URL!);
 await db.execute(sql\`CREATE TABLE IF NOT EXISTS nordix_local_bootstrap (id integer PRIMARY KEY, state text NOT NULL)\`);
 const existing=await db.execute(sql\`SELECT state FROM nordix_local_bootstrap WHERE id=1\`);
 if(existing.rows.length){
  if(existing.rows[0].state!=="complete")throw new Error("Local seed previously failed or is running. Inspect the database before retrying; reset only a disposable local volume.");
  return;
 }
 // A durable claim prevents concurrent starts or failed retries from duplicating synthetic data.
 const claim=await db.execute(sql\`INSERT INTO nordix_local_bootstrap(id,state) VALUES(1,'pending') ON CONFLICT DO NOTHING RETURNING id\`);
 if(!claim.rows.length)throw new Error("Another local bootstrap is running. Retry after it completes.");
 await seedDatabase();
 await db.execute(sql\`UPDATE nordix_local_bootstrap SET state='complete' WHERE id=1\`);
}
`,
          },
        ]
      : []),
  ];
}
