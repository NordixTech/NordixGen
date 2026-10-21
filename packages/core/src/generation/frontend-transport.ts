import type { GeneratedFile } from "../plugins/contracts.js";
import type { FrontendRenderContext } from "../plugins/frontend-contracts.js";
import { serviceBinding } from "./cloudflare.js";

/** Only this server module knows backend destinations. Browser code uses same-origin routes. */
export function frontendTransportFiles(context: FrontendRenderContext): GeneratedFile[] {
  const root = context.framework.codeRoot;
  const connections = context.frontend.connections;
  const bindings = Object.fromEntries(connections.map((name) => [name, serviceBinding(name)]));
  const local = Object.fromEntries(
    connections.map((name, index) => [name, `http://localhost:${8787 + index}`]),
  );
  const identity = context.frontend.identity?.backend;
  const route = (backend: string) => `import {proxyBackend} from "@/lib/backend/transport";
export const dynamic="force-dynamic";
async function handler(request:Request){return proxyBackend(${JSON.stringify(backend)},request,new URL(request.url).pathname);}
export {handler as GET,handler as POST,handler as PUT,handler as PATCH,handler as DELETE,handler as OPTIONS,handler as HEAD};
`;
  return [
    {
      path: `${context.framework.applicationRoot}/cloudflare-env.d.ts`,
      content: `export {};
declare global { interface CloudflareEnv {${connections.map((backend) => `${serviceBinding(backend)}:{fetch(request:Request):Promise<Response>};`).join("\n")} } }
`,
    },
    {
      path: `${root}/lib/backend/transport.ts`,
      content: `import "server-only";
import {getCloudflareContext} from "@opennextjs/cloudflare";
type Service={fetch(request:Request):Promise<Response>};
const bindings:Readonly<Record<string,string>>=${JSON.stringify(bindings)};
const defaults:Readonly<Record<string,string>>=${JSON.stringify(local)};
function safePath(path:string){if(!path.startsWith("/")||path.startsWith("//")||path.includes("\\\\")||/[\\r\\n]/.test(path))throw Error("Invalid backend path");return path;}
export async function backendFetch(backend:string,path:string,init:RequestInit={},origin="https://internal.invalid"):Promise<Response>{
 const binding=bindings[backend];if(!binding)throw Error("Unknown backend");safePath(path);
 let env:Record<string,unknown>|undefined;
 // Read only the active Worker context. Async discovery would start Wrangler inside next start.
 if(process.env.NORDIX_LOCAL_RUNTIME!=="1")try{env=(await getCloudflareContext()).env as unknown as Record<string,unknown>;}catch{}
 const service=env?.[binding] as Service|undefined;
 const headers=new Headers(init.headers);headers.delete("host");headers.delete("connection");headers.delete("content-length");
 const request=new Request(new URL(path,origin),{...init,headers,redirect:"manual"});
 if(service)return service.fetch(request);
 // HTTP fallback is opt-in for local Next standalone/Docker, or next dev only.
 if(process.env.NODE_ENV!=="development"&&process.env.NORDIX_LOCAL_RUNTIME!=="1")throw Error("Required private backend binding is unavailable");
 const key="BACKEND_"+backend.toUpperCase().replaceAll("-","_")+"_INTERNAL_URL";
 const base=new URL(process.env[key]??defaults[backend]);
 if(!["http:","https:"].includes(base.protocol)||base.username||base.password||base.pathname!=="/"||base.search||base.hash)throw Error("Invalid local backend origin");
 return fetch(new Request(new URL(path,base),request));
}
export async function proxyBackend(backend:string,request:Request,path:string):Promise<Response>{
 try{
  const url=new URL(request.url);const headers=new Headers(request.headers);
  headers.delete("x-nordix-client-ip");
  headers.delete("x-nordix-mcp-gateway");
  headers.set("x-nordix-client-ip",process.env.NODE_ENV==="development"||process.env.NORDIX_LOCAL_RUNTIME==="1"?"127.0.0.1":request.headers.get("cf-connecting-ip")??"unknown");
  for(const name of ["host","connection","content-length","forwarded","x-forwarded-host","x-forwarded-proto"])headers.delete(name);
  const init:RequestInit & {duplex?:"half"}={method:request.method,headers,signal:request.signal};
  if(!["GET","HEAD"].includes(request.method)){init.body=request.body;init.duplex="half";}
  const response=await backendFetch(backend,safePath(path)+url.search,init,url.origin);
  const result=new Headers(response.headers);result.delete("connection");result.set("Cache-Control","private, no-store");
  // Preserve individual Set-Cookie headers, including OAuth/session cookies.
  if(typeof response.headers.getSetCookie==="function"){result.delete("set-cookie");for(const cookie of response.headers.getSetCookie())result.append("set-cookie",cookie);}
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers:result});
 }catch(error){
  if(process.env.NORDIX_LOCAL_RUNTIME==="1"){
   const failure=error as {name?:string;cause?:{code?:string};message?:string};
   const known=["Unknown backend","Invalid backend path","Required private backend binding is unavailable","Invalid local backend origin"].find(message=>message===failure?.message);
   const code=failure?.cause?.code;
   console.error("Local backend proxy unavailable",{backend,reason:known??failure?.name??"Unknown",code:code&&/^[A-Z_0-9]+$/.test(code)?code:undefined});
  }
  return Response.json({title:"Backend unavailable",status:503},{status:503,headers:{"Cache-Control":"no-store"}});
 }
}
`,
    },
    {
      path: `${root}/app/api/backend/[backend]/[...path]/route.ts`,
      content: `import {proxyBackend} from "@/lib/backend/transport";
export const dynamic="force-dynamic";
async function handler(request:Request,context:{params:Promise<{backend:string;path:string[]}>}){
 const {backend,path}=await context.params;
 if(!${JSON.stringify(connections)}.includes(backend))return new Response(null,{status:404});
 if(path[0]==="mcp")return new Response(null,{status:404});
 return proxyBackend(backend,request,"/"+path.map(encodeURIComponent).join("/"));
}
export {handler as GET,handler as POST,handler as PUT,handler as PATCH,handler as DELETE,handler as OPTIONS,handler as HEAD};
`,
    },
    ...(identity
      ? [
          { path: `${root}/app/api/auth/[...path]/route.ts`, content: route(identity) },
          { path: `${root}/app/api/auth/iam/[...path]/route.ts`, content: route(identity) },
        ]
      : []),
  ];
}
