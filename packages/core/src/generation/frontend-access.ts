import type { GeneratedFile } from "../plugins/contracts.js";
import type { FrontendRenderContext } from "../plugins/frontend-contracts.js";

/** A frontend selects one identity authority; public URLs contain no credentials. */
export function identityBaseUrl(context: FrontendRenderContext): string {
  return `process.env.NEXT_PUBLIC_AUTH_BASE_URL${context.frontend.connections.length === 1 ? " ?? process.env.NEXT_PUBLIC_API_BASE_URL" : ""} ?? ""`;
}

export function generateFrontendAccess(context: FrontendRenderContext): readonly GeneratedFile[] {
  if (!context.frontend.identity) return [];
  const pages = Object.fromEntries(
    context.frontend.pages.map((page) => [page.path, page.authenticated]),
  );
  return [
    {
      path: `${context.framework.codeRoot}/lib/auth/server.ts`,
      content: `import "server-only";
import {headers} from "next/headers";
import {redirect} from "next/navigation";
const protectedPages:Readonly<Record<string,boolean>>=${JSON.stringify(pages)};
export interface VerifiedPageSession {user:{id:string;role?:string|null};session:Record<string,unknown>;}
export class IdentityUnavailable extends Error {constructor(){super("The identity service is unavailable. Please try again.");this.name="IdentityUnavailable";}}
/** Called at each protected page boundary, including server navigation. No cookie-presence authorization. */
export async function requirePageSession(path:string):Promise<VerifiedPageSession|null> {
 if(protectedPages[path]===false)return null;
 const cookie=(await headers()).get("cookie");
 if(!cookie)redirect("/sign-in");
 let session:VerifiedPageSession|null;
 try {
  const base=${identityBaseUrl(context)};
  const authority=new URL(base);
  if(!["http:","https:"].includes(authority.protocol)||authority.username||authority.password||authority.pathname!=="/"||authority.search||authority.hash)throw new IdentityUnavailable();
  const response=await fetch(new URL("/api/auth/get-session",authority),{headers:{cookie},cache:"no-store",redirect:"error",signal:AbortSignal.timeout(5000)});
  if(response.status===401)session=null;
  else {
   if(!response.ok)throw new IdentityUnavailable();
   const value:unknown=await response.json();
   if(value===null)session=null;
   else if(typeof value==="object" && "user" in value && value.user && typeof value.user==="object" && "id" in value.user && typeof value.user.id==="string" && value.user.id.length>0 && "session" in value && value.session && typeof value.session==="object")session=value as VerifiedPageSession;
   else throw new IdentityUnavailable();
  }
 }catch{throw new IdentityUnavailable();}
 if(!session)redirect("/sign-in");
 return session;
}
`,
    },
  ];
}

/** Apply the resolved access decision to each emitted server page, before its content renders. */
export function protectFrontendPage(
  context: FrontendRenderContext,
  file: GeneratedFile,
): GeneratedFile {
  const page = context.frontend.pages.find(
    (page) =>
      file.path ===
      `${context.framework.codeRoot}/app${page.path === "/" ? "" : page.path}/page.tsx`,
  );
  if (!page?.authenticated) return file;
  const content = file.content.replace(
    /export default function (\w+)\(\)\s*\{/,
    `export default async function $1() {\n await requirePageSession(${JSON.stringify(page.path)});`,
  );
  if (content === file.content)
    throw Error(`Protected page ${file.path} must expose a named server component.`);
  return {
    ...file,
    content: `import {requirePageSession} from "@/lib/auth/server";\nexport const dynamic="force-dynamic";\n${content}`,
  };
}
