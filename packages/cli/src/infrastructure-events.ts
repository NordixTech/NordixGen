import { randomBytes } from "node:crypto";
import { execa } from "execa";
import type { DeploymentProfile } from "./deployment-model.js";

/** Webhook delivery starts a native build; OpenTofu never runs inside a Worker. */
export const reviewWebhookSource = String.raw`export default {async fetch(request,env){
 if(request.method!=="POST")return new Response(null,{status:405});
 const body=await request.text();if(body.length>2000000)return new Response(null,{status:413});
 const signature=request.headers.get("x-hub-signature-256")??"";
 const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(env.WEBHOOK_SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
 const digest=await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(body));
 const expected="sha256="+Array.from(new Uint8Array(digest),value=>value.toString(16).padStart(2,"0")).join("");
 let difference=signature.length^expected.length;for(let i=0;i<expected.length;i++)difference|=expected.charCodeAt(i)^(signature.charCodeAt(i)||0);
 if(difference!==0)return new Response(null,{status:401});
 if(request.headers.get("x-github-event")==="ping")return new Response("ok");
 if(request.headers.get("x-github-event")!=="pull_request")return new Response(null,{status:204});
 let payload;try{payload=JSON.parse(body);}catch{return new Response(null,{status:400});}
 const pr=payload.pull_request;
 if(!["opened","reopened","synchronize","edited","ready_for_review"].includes(payload.action)||!pr||pr.head.repo?.full_name!==env.REPOSITORY||pr.base.repo?.full_name!==env.REPOSITORY||!["develop","main"].includes(pr.base.ref))return new Response(null,{status:204});
 const result=await fetch("https://api.cloudflare.com/client/v4/accounts/"+env.ACCOUNT_ID+"/builds/triggers/"+(pr.head.ref==="main"?env.PRIMARY_TRIGGER_ID:env.TRIGGER_ID)+"/builds",{method:"POST",headers:{Authorization:"Bearer "+env.BUILDS_TOKEN,"Content-Type":"application/json"},body:JSON.stringify({branch:pr.head.ref,commit_hash:pr.head.sha})});
 return new Response(null,{status:result.ok?202:502});
}};`;
export async function configureReviewEvents(
  profile: DeploymentProfile,
  worker: string,
  triggerId: string,
  setupToken: string,
  eventsToken: string,
  request: (path: string, method?: string, body?: unknown) => Promise<unknown>,
  primaryTriggerId: string,
) {
  const name = `${worker.slice(0, 56)}-events`;
  const secret = randomBytes(32).toString("hex");
  const form = new FormData();
  form.append(
    "metadata",
    JSON.stringify({
      main_module: "events.mjs",
      compatibility_date: "2026-10-01",
      bindings: [
        { type: "secret_text", name: "WEBHOOK_SECRET", text: secret },
        { type: "secret_text", name: "BUILDS_TOKEN", text: eventsToken },
        { type: "plain_text", name: "ACCOUNT_ID", text: profile.accountId },
        { type: "plain_text", name: "TRIGGER_ID", text: triggerId },
        { type: "plain_text", name: "PRIMARY_TRIGGER_ID", text: primaryTriggerId },
        { type: "plain_text", name: "REPOSITORY", text: profile.repository },
      ],
    }),
  );
  form.append(
    "events.mjs",
    new Blob([reviewWebhookSource], { type: "application/javascript+module" }),
    "events.mjs",
  );
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${profile.accountId}/workers/scripts/${name}`,
    { method: "PUT", headers: { Authorization: `Bearer ${setupToken}` }, body: form },
  );
  if (!response.ok) throw Error("Could not configure the signed PR event receiver");
  await request(`/workers/scripts/${name}/subdomain`, "POST", {
    enabled: true,
    previews_enabled: false,
  });
  const subdomain = (await request("/workers/subdomain")) as { subdomain: string };
  const url = `https://${name}.${subdomain.subdomain}.workers.dev`;
  const hooks = JSON.parse(
    (
      await execa("gh", ["api", `repos/${profile.repository}/hooks`], {
        stdout: "pipe",
        stderr: "pipe",
      })
    ).stdout,
  ) as { id: number; config: { url: string } }[];
  const existing = hooks.find((hook) => hook.config.url === url);
  await execa(
    "gh",
    [
      "api",
      "--method",
      existing ? "PATCH" : "POST",
      `repos/${profile.repository}/hooks${existing ? `/${existing.id}` : ""}`,
      "--input",
      "-",
    ],
    {
      input: JSON.stringify({
        name: "web",
        active: true,
        events: ["pull_request"],
        config: { url, content_type: "json", secret, insecure_ssl: "0" },
      }),
      stdout: "pipe",
      stderr: "pipe",
    },
  ).catch(() => {
    throw Error(
      "Could not connect PR events. GitHub setup access needs repository webhook administration; no webhook secret was printed.",
    );
  });
}
