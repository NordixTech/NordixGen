import type { GeneratedFile } from "../plugins/contracts.js";
import type { FrontendRenderContext } from "../plugins/frontend-contracts.js";
import { storageBrowserSource, storageBrowserStyles } from "./storage-browser-ui.js";
export function frontendStorageFiles(context: FrontendRenderContext): GeneratedFile[] {
  if (!context.frontend.storageBackends.length) return [];
  const root = context.framework.codeRoot;
  return [
    {
      path: `${root}/components/storage/storage-browser.tsx`,
      content: storageBrowserSource
        .replace(
          "__STORAGE_SESSION_IMPORTS__",
          context.api.authentication
            ? 'import {useSessionView} from "@/lib/auth/use-session-view";\nimport {sessionCacheIdentity} from "@/lib/api/cache";'
            : "",
        )
        .replace(
          "__STORAGE_SESSION_SCOPE__",
          context.api.authentication
            ? "const scope=sessionCacheIdentity(useSessionView());"
            : 'const scope="anonymous";',
        )
        .replace("__STORAGE_BACKENDS__", JSON.stringify(context.frontend.storageBackends))
        .replace("__HAS_IDENTITY__", JSON.stringify(Boolean(context.api.authentication))),
    },
    { path: `${root}/styles/storage.css`, content: storageBrowserStyles },
    {
      path: `${root}/lib/storage/initial-data.ts`,
      content: `import "server-only";
import {headers} from "next/headers";
import {backendFetch} from "@/lib/backend/transport";
import type {InitialStorage} from "@/components/storage/storage-browser";
${context.api.authentication ? 'import {getInitialIdentity} from "@/lib/auth/server";\nimport {sessionCacheIdentity} from "@/lib/api/cache";' : ""}
export async function initialStorage():Promise<InitialStorage|undefined>{
${
  context.api.authentication
    ? `const user=await getInitialIdentity();if(!user)return undefined;
 const scope=sessionCacheIdentity({isPending:false,user});
 const cookie=(await headers()).get("cookie")??"";
 try{
 const groups=await Promise.all(${JSON.stringify(context.frontend.storageBackends)}.map(async backend=>{const response=await backendFetch(backend,"/api/storage/instances",{headers:{cookie},cache:"no-store",signal:AbortSignal.timeout(5000)});if(!response.ok)throw Error("Storage unavailable");const data=await response.json() as {instances:InitialStorage["instances"]};return data.instances.map(item=>({...item,backend}));}));
 const instances=groups.flat(),first=instances[0],selected=first?first.backend+":"+first.key:"";
 let listing:InitialStorage["listing"];
 if(first?.canRead){const response=await backendFetch(first.backend,"/api/storage/"+encodeURIComponent(first.key)+"/objects?prefix=",{headers:{cookie},cache:"no-store",signal:AbortSignal.timeout(5000)});if(!response.ok)throw Error("Storage unavailable");listing=await response.json();}
 return {scope,instances,selected,...(listing?{listing}:{})};
 }catch{return undefined;}`
    : "return undefined;"
}
}
`,
    },
    {
      path: `${root}/app/r2/page.tsx`,
      content: `import {StorageBrowser} from "@/components/storage/storage-browser";
import {initialStorage} from "@/lib/storage/initial-data";
import "@/styles/storage.css";
export const metadata={title:"Instancias R2"};
export default async function StoragePage(){const initial=await initialStorage();return <main className="ng-shell ng-storage-page"><header className="ng-storage-heading"><p className="ng-eyebrow">Workspace storage</p><h1>Instancias R2</h1><p>Browse your storage, upload documents and choose how to download them.</p></header><StorageBrowser initial={initial}/></main>;}
`,
    },
  ];
}
