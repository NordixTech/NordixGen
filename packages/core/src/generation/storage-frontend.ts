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
        .replace("__STORAGE_BACKENDS__", JSON.stringify(context.frontend.storageBackends))
        .replace("__HAS_IDENTITY__", JSON.stringify(Boolean(context.api.authentication))),
    },
    { path: `${root}/styles/storage.css`, content: storageBrowserStyles },
    {
      path: `${root}/app/r2/page.tsx`,
      content: `import {StorageBrowser} from "@/components/storage/storage-browser";
import "@/styles/storage.css";
export const metadata={title:"Instancias R2"};
export default function StoragePage(){return <main className="ng-shell ng-storage-page"><header className="ng-storage-heading"><p className="ng-eyebrow">Workspace storage</p><h1>Instancias R2</h1><p>Browse your storage, upload documents and choose how to download them.</p></header><StorageBrowser/></main>;}
`,
    },
  ];
}
