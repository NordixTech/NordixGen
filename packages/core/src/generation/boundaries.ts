import type { BackendRenderContext, GeneratedFile } from "../plugins/contracts.js";
/** Standalone generated-project check; TypeScript is existing development tooling. */
export function generateBoundaryCheck(context: BackendRenderContext): GeneratedFile {
  const modules = context.domainModel.modules.map((module) => ({
    name: module.name,
    id: module.id,
    dependencies: module.dependencies,
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
 const local=path.slice(("src/modules/"+consumer.name+"/").length);const inward=local.startsWith("domain/")||local.startsWith("application/");
 function fail(node,code,detail){const at=source.getLineAndCharacterOfPosition(node.getStart(source));errors.push(code+": Consumer "+consumer.id+" at "+path+":"+(at.line+1)+": "+detail);}
 function check(node,specifier){
  if(!ts.isStringLiteralLike(specifier)){fail(node,"MODULE_DYNAMIC_IMPORT_UNSUPPORTED","Use a static declared public application import.");return;}
  const name=specifier.text;const target=name.startsWith(".")?unix(relative(root,resolve(dirname(file),name))).replace(/\\.js$/,".ts"):name;const producer=owner(target);
  if(inward && (/^(hono|drizzle-orm|@neondatabase|better-auth)(\\/|$)/.test(name)||/(^|\\/)(infrastructure|presentation)\\//.test(target)||target.includes("/platform/database/")||target.includes("/platform/auth/")||target.includes("/platform/http/")))fail(node,"ARCHITECTURE_DEPENDENCY_INVALID","Reference "+name+" depends on HTTP/persistence/identity infrastructure. Inject an application port instead.");
  if(producer && producer.id!==consumer.id){
   if(target!=="src/modules/"+producer.name+"/index.ts")fail(node,"MODULE_PRIVATE_IMPORT","Producer "+producer.id+" reference "+name+" is private. Import its public entry instead.");
   else if(!consumer.dependencies.includes(producer.id))fail(node,"MODULE_DEPENDENCY_UNDECLARED","Producer "+producer.id+" reference "+name+" is undeclared. Declare the permitted application dependency.");
  }
  if(local==="index.ts" && !target.startsWith("src/modules/"+consumer.name+"/public/"))fail(node,"MODULE_PRIVATE_EXPORT","Public entry reference "+name+" exposes private implementation. Export only public application contracts.");
 }
 function visit(node){if((ts.isImportDeclaration(node)||ts.isExportDeclaration(node))&&node.moduleSpecifier)check(node,node.moduleSpecifier);if(ts.isCallExpression(node)&&(node.expression.kind===ts.SyntaxKind.ImportKeyword||(ts.isIdentifier(node.expression)&&node.expression.text==="require")))check(node,node.arguments[0]);ts.forEachChild(node,visit);}
 visit(source);
}
if(errors.length){console.error(errors.join("\\n"));process.exitCode=1;}else console.log("Module and Clean dependency boundaries passed.");
`,
  };
}
