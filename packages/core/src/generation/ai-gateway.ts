import type { BackendRenderContext, GeneratedFile } from "../plugins/contracts.js";
import { cloudflareWorkerName } from "./cloudflare.js";

export function aiGatewayFiles(context: BackendRenderContext): GeneratedFile[] {
  const backend = context.domainModel.backend;
  const name = cloudflareWorkerName(context.projectName, `${backend.name}-mcp`);
  const worker = cloudflareWorkerName(context.projectName, backend.name);
  const root = `${backend.path}/mcp-gateway`;
  const environment = (suffix: string) => ({
    name: `${name}${suffix}`,
    workers_dev: true,
    preview_urls: false,
    services: [{ binding: "BACKEND", service: `${worker}${suffix}` }],
    vars: {
      OAUTH_ENABLED: (backend.ai as NonNullable<typeof backend.ai>).mcp.authMethods.includes(
        "oauth",
      )
        ? "1"
        : "0",
    },
  });
  return [
    {
      path: `${root}/wrangler.jsonc`,
      content: `${JSON.stringify(
        {
          main: "index.ts",
          compatibility_date: "2026-10-01",
          ...environment(""),
          env: { staging: environment("-staging"), production: environment("-production") },
        },
        null,
        2,
      )}\n`,
    },
    { path: `${root}/index.ts`, content: gatewaySource },
    {
      path: `${root}/local-server.mjs`,
      content: `import {serve} from "@hono/node-server";
import {request as httpRequest} from "node:http";
import {request as httpsRequest} from "node:https";
import {Readable} from "node:stream";
import gateway from "./index.ts";
const backend=new URL(process.env.BACKEND_INTERNAL_URL??"http://localhost:8787");
if(!["http:","https:"].includes(backend.protocol)||backend.username||backend.password||backend.pathname!=="/")throw Error("Invalid local backend origin");
// Native HTTP preserves browser Fetch Metadata; Node fetch would rewrite Sec-Fetch-Mode to cors.
function forward(incoming){return new Promise((resolve,reject)=>{
 const source=new URL(incoming.url),url=new URL(source.pathname+source.search,backend);
 const headers=new Headers(incoming.headers);headers.delete("host");headers.delete("connection");headers.delete("content-length");
 const request=(url.protocol==="https:"?httpsRequest:httpRequest)(url,{method:incoming.method,headers:Object.fromEntries(headers),signal:incoming.signal},response=>{
  const result=new Headers();for(const [name,value] of Object.entries(response.headers)){if(value!==undefined)for(const item of Array.isArray(value)?value:[value])result.append(name,item);}
  const status=response.statusCode??502;resolve(new Response([204,205,304].includes(status)?null:Readable.toWeb(response),{status,headers:result}));
 });
 request.on("error",reject);if(incoming.body)Readable.fromWeb(incoming.body).on("error",error=>request.destroy(error)).pipe(request);else request.end();
});}
const server=serve({hostname:"0.0.0.0",port:Number(process.env.PORT??8790),fetch(request){return gateway.fetch(request,{OAUTH_ENABLED:process.env.OAUTH_ENABLED??"1",BACKEND:{fetch:forward}});}});
for(const signal of ["SIGTERM","SIGINT"])process.on(signal,()=>server.close(()=>process.exit(0)));
`,
    },
    {
      path: `${root}/package.json`,
      content: `${JSON.stringify(
        {
          name: `${backend.name}-mcp-gateway`,
          private: true,
          type: "module",
          scripts: { dev: "wrangler dev --port 8790", typecheck: "tsc --noEmit" },
          dependencies: { "@hono/node-server": "2.1.5" },
          devDependencies: { typescript: "^5.8.2", wrangler: "4.152.0" },
        },
        null,
        2,
      )}\n`,
    },
    {
      path: `${root}/tsconfig.json`,
      content: `${JSON.stringify(
        {
          compilerOptions: {
            target: "ES2022",
            module: "ESNext",
            moduleResolution: "Bundler",
            lib: ["ES2022", "DOM"],
            strict: true,
            noEmit: true,
            skipLibCheck: true,
          },
          include: ["index.ts"],
        },
        null,
        2,
      )}\n`,
    },
  ];
}
export const gatewaySource = `interface GatewayEnvironment {BACKEND:{fetch(request:Request):Promise<Response>};OAUTH_ENABLED:string;}
const authPaths=new Set([
 "/api/auth/oauth2/authorize","/api/auth/oauth2/token","/api/auth/oauth2/register","/api/auth/oauth2/consent","/api/auth/oauth2/revoke","/api/auth/oauth2/public-client",
 "/api/auth/sign-in/email","/api/auth/sign-in/username","/api/auth/sign-in/social","/api/auth/get-session","/api/auth/sign-out",
 "/api/auth/phone-number/send-otp","/api/auth/phone-number/verify","/api/auth/two-factor/verify-totp","/api/auth/two-factor/verify-otp","/api/auth/two-factor/send-otp",
]);
export default {async fetch(request:Request,env:GatewayEnvironment):Promise<Response>{
 const url=new URL(request.url);const oauth=env.OAUTH_ENABLED==="1";
 const metadata=["/.well-known/oauth-protected-resource","/.well-known/oauth-protected-resource/mcp","/.well-known/oauth-authorization-server","/.well-known/oauth-authorization-server/api/auth","/api/auth/.well-known/oauth-authorization-server"].includes(url.pathname);
 const aliases:Record<string,string>={"/authorize":"/api/auth/oauth2/authorize","/token":"/api/auth/oauth2/token"};
 const callback=/^\\/api\\/auth\\/callback\\/(google|github|microsoft|facebook)$/.test(url.pathname);
 if(url.pathname!=="/mcp"&&!(oauth&&(metadata||authPaths.has(url.pathname)||Object.hasOwn(aliases,url.pathname)||callback||["/sign-in","/consent"].includes(url.pathname))))return new Response(null,{status:404});
 if(!["GET","POST","DELETE","OPTIONS"].includes(request.method))return new Response(null,{status:405});
 const headers=new Headers(request.headers);headers.delete("x-nordix-client-ip");headers.set("x-nordix-client-ip",request.headers.get("cf-connecting-ip")??"unknown");headers.set("x-nordix-mcp-gateway","1");
 if(url.pathname==="/api/auth/.well-known/oauth-authorization-server")url.pathname="/.well-known/oauth-authorization-server/api/auth";
 if(Object.hasOwn(aliases,url.pathname))url.pathname=aliases[url.pathname];
 let expectedState=url.pathname==="/api/auth/oauth2/authorize"?url.searchParams.get("state"):null;
 const jsonBody=url.pathname.startsWith("/api/auth/")&&request.method==="POST"&&request.headers.get("content-type")?.includes("application/json")?await request.clone().json().catch(()=>null) as {oauth_query?:unknown}|null:null;
 if(typeof jsonBody?.oauth_query==="string")expectedState=new URLSearchParams(jsonBody.oauth_query).get("state");
 // A Service Binding invokes the private backend. Returning the response preserves its stream.
 const init:RequestInit & {duplex?:"half"}={method:request.method,headers,body:["GET","HEAD"].includes(request.method)?undefined:request.body,redirect:"manual",signal:request.signal,duplex:"half"};
 const response=await env.BACKEND.fetch(new Request(url,init));
 if(url.pathname==="/mcp")return response;
 // The public authorization server is the gateway origin; /api/auth is an endpoint prefix.
 // Keep RFC 8414 discovery and RFC 9207 callbacks identical, including root-only discovery clients.
 const issuer=url.origin;
 const canonical=(value:string)=>{const target=new URL(value,url);if(target.searchParams.has("code")||target.searchParams.has("error")){const state=target.searchParams.get("state");if(expectedState!==null&&state!==expectedState)throw Error("OAuth response state mismatch");target.searchParams.set("iss",issuer);}return target.href;};
 const resultHeaders=new Headers(response.headers);resultHeaders.set("Cache-Control","no-store");
 if(metadata&&response.ok&&response.headers.get("content-type")?.includes("application/json")){
  const body=await response.json() as Record<string,unknown>;
  if(url.pathname.includes("oauth-protected-resource"))body.authorization_servers=[issuer];else {body.issuer=issuer;body.authorization_response_iss_parameter_supported=true;}
  resultHeaders.delete("content-length");return new Response(JSON.stringify(body),{status:response.status,headers:resultHeaders});
 }
 const location=resultHeaders.get("location");if(location)resultHeaders.set("location",canonical(location));
 if(!location&&response.status!==204&&response.status!==304&&["/api/auth/oauth2/authorize","/api/auth/oauth2/consent","/api/auth/sign-in/email","/api/auth/sign-in/username","/api/auth/two-factor/verify-totp","/api/auth/two-factor/verify-otp"].includes(url.pathname)&&response.headers.get("content-type")?.includes("application/json")){
  const body=await response.json() as Record<string,unknown>;
  for(const key of ["url","redirect_uri"])if(typeof body[key]==="string")body[key]=canonical(body[key] as string);
  resultHeaders.delete("content-length");return new Response(JSON.stringify(body),{status:response.status,headers:resultHeaders});
 }
 return new Response(response.body,{status:response.status,headers:resultHeaders});
}};
`;
