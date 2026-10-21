import { resolveArchitectureLayout } from "../plugins/architecture/layout.js";
import type { BackendRenderContext, GeneratedFile } from "../plugins/contracts.js";
/** Standalone generated-project check; TypeScript is existing development tooling. */
export function generateBoundaryCheck(context: BackendRenderContext): GeneratedFile {
  const modules = context.domainModel.modules.map((module) => ({
    name: module.name,
    id: module.id,
    dependencies: module.dependencies,
    layout: resolveArchitectureLayout(module.architecture),
  }));
  return {
    path: `${context.framework.applicationRoot}/scripts/check-boundaries.mjs`,
    content: `import ts from "typescript";
import {readFileSync,readdirSync} from "node:fs";
import {resolve,relative,dirname} from "node:path";
import {fileURLToPath} from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const modules=${JSON.stringify(modules)};
const errors=[];
const unix=path=>path.replaceAll("\\\\","/");
function owner(path){return modules.find(module=>path.startsWith("src/modules/"+module.name+"/"));}
function walk(directory){return readdirSync(directory,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?walk(resolve(directory,entry.name)):entry.name.endsWith(".ts")?[resolve(directory,entry.name)]:[]);}
for(const file of walk(resolve(root,"src"))){
 const path=unix(relative(root,file));const consumer=owner(path);if(!consumer)continue;
 const text=readFileSync(file,"utf8");const source=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true);
 const local=path.slice(("src/modules/"+consumer.name+"/").length);const domain=local.startsWith(consumer.layout.domainRoot+"/");const inward=domain||local.startsWith(consumer.layout.applicationRoot+"/");
 function fail(node,code,detail){const at=source.getLineAndCharacterOfPosition(node.getStart(source));errors.push(code+": Consumer "+consumer.id+" at "+path+":"+(at.line+1)+": "+detail);}
 function check(node,specifier){
  if(!ts.isStringLiteralLike(specifier)){fail(node,"MODULE_DYNAMIC_IMPORT_UNSUPPORTED","Use a static declared public application import.");return;}
  const name=specifier.text;const target=name.startsWith(".")?unix(relative(root,resolve(dirname(file),name))).replace(/\\.js$/,".ts"):name;const producer=owner(target);const targetLocal=producer?target.slice(("src/modules/"+producer.name+"/").length):"";const concrete=producer&&(targetLocal.startsWith(producer.layout.directories.infrastructure+"/")||targetLocal.startsWith(producer.layout.directories.controller+"/"));
  if(inward && (/^(hono|drizzle-orm|@neondatabase|better-auth)(\\/|$)/.test(name)||concrete||target.includes("/platform/database/")||target.includes("/platform/auth/")||target.includes("/platform/http/")))fail(node,"ARCHITECTURE_DEPENDENCY_INVALID","Reference "+name+" depends on HTTP/persistence/identity infrastructure. Inject an application port instead.");
  if(inward && producer?.id===consumer.id && !(target.startsWith("src/modules/"+consumer.name+"/"+consumer.layout.domainRoot+"/") || target.startsWith("src/modules/"+consumer.name+"/"+consumer.layout.applicationRoot+"/") || target.endsWith("/public/contracts.ts")))fail(node,"ARCHITECTURE_DEPENDENCY_INVALID","Core depends on a concrete composition or outer implementation. Use an inward application port.");
  if(local.startsWith("adapters/inbound/") && producer && targetLocal.startsWith("adapters/outbound/"))fail(node,"ARCHITECTURE_DEPENDENCY_INVALID","Driving adapters must invoke application input ports, not driven adapters.");
  if(ts.isExportDeclaration(node) && local.startsWith("public/") && !target.startsWith("src/modules/"+consumer.name+"/public/"))fail(node,"MODULE_PRIVATE_EXPORT","Public contracts cannot re-export private implementations.");
  if(domain && ((producer && (targetLocal.startsWith(producer.layout.applicationRoot+"/") || targetLocal.startsWith("public/") || producer.id!==consumer.id)) || target.includes("/platform/application/")))fail(node,"ARCHITECTURE_DEPENDENCY_INVALID","Domain must not depend on application services, public application contracts or another module. Inject dependencies in the application layer.");
  if(target.includes("/platform/database/schema/index.ts"))fail(node,"MODULE_PRIVATE_SCHEMA_IMPORT","Reference "+name+" exposes all backend tables. Import this module's owned schema instead.");
  if(target.endsWith("/platform/database/drizzle-database.ts") && local!==consumer.layout.databaseClient)fail(node,"MODULE_SHARED_DATABASE_IMPORT","Reference "+name+" exposes another module\'s query types. Use the injected module database type.");
  if(producer && producer.id!==consumer.id){
   if(target!=="src/modules/"+producer.name+"/index.ts")fail(node,"MODULE_PRIVATE_IMPORT","Producer "+producer.id+" reference "+name+" is private. Import its public entry instead.");
   else if(!consumer.dependencies.includes(producer.id))fail(node,"MODULE_DEPENDENCY_UNDECLARED","Producer "+producer.id+" reference "+name+" is undeclared. Declare the permitted application dependency.");
  }
  if(local==="index.ts" && !target.startsWith("src/modules/"+consumer.name+"/public/"))fail(node,"MODULE_PRIVATE_EXPORT","Public entry reference "+name+" exposes private implementation. Export only public application contracts.");
 }
 function visit(node){if((ts.isImportDeclaration(node)||ts.isExportDeclaration(node))&&node.moduleSpecifier)check(node,node.moduleSpecifier);if(ts.isCallExpression(node)&&(node.expression.kind===ts.SyntaxKind.ImportKeyword||(ts.isIdentifier(node.expression)&&node.expression.text==="require")))check(node,node.arguments[0]);ts.forEachChild(node,visit);}
 visit(source);
}
if(errors.length){console.error(errors.join("\\n"));process.exitCode=1;}else console.log("Module and architecture dependency boundaries passed.");
`,
  };
}
