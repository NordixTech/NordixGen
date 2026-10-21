export const aiRegistrySource = `import {z} from "zod";
import {zodToJsonSchema} from "zod-to-json-schema";
import {generatedTools} from "./generated-tools.js";
import customTools from "./custom-tools.js";
import type {AppTool} from "./define-tool.js";
import {createOperationBoundary} from "../application/access.js";
import {ApplicationFailure,type ApplicationResult,type Principal,type AuditChange,type OperationContext} from "../application/contracts.js";
import {isAuthorized,type Permission} from "../authorization/policy.js";
import {createRouteDependencies} from "../database/create-route-dependencies.js";
type Module={operations:Record<string,(input:never,ctx:OperationContext)=>Promise<ApplicationResult<unknown>>>;checkAccess(operation:string,ctx:OperationContext):{code:"forbidden";message:string}|undefined};
export class ToolFailure extends Error{constructor(readonly status:number,message:string){super(message);}}
export function toolRegistry(connection:string,headers:Headers,verify:()=>Promise<Principal|null>,signal:AbortSignal,requireConfirmation:boolean,storage:unknown,capture?:(change:AuditChange)=>void){
 const tools=new Map<string,AppTool>();
 for(const tool of [...generatedTools,...customTools] as AppTool[]){if(tools.has(tool.name))throw Error("Duplicate AI tool name: "+tool.name);tools.set(tool.name,tool);}
 const permitted=(principal:Principal,tool:AppTool)=>isAuthorized(principal,{permissions:tool.permissions as Permission[]});
 return {
 async list(){const principal=await verify();if(!principal)throw new ToolFailure(401,"Authentication required.");return [...tools.values()].filter(tool=>permitted(principal,tool));},
 schema(tool:AppTool,mcp=false){const schema=zodToJsonSchema(tool.schema,{$refStrategy:"none"}) as Record<string,unknown>;delete schema.$schema;
  if(mcp&&tool.isDestructive&&requireConfirmation){schema.properties={...(schema.properties as object),confirm:{type:"boolean",const:true,description:"Set true only after the user approves this mutation."}};schema.required=[...((schema.required as string[])??[]),"confirm"];}
  return schema;
 },
 async execute(name:string,args:unknown,confirmed=false){
  const tool=tools.get(name);if(!tool)throw new ToolFailure(404,"Unknown tool.");
  const principal=await verify();if(!principal)throw new ToolFailure(401,"Authentication required.");
  if(!permitted(principal,tool))throw new ToolFailure(403,"Required permissions are missing.");
  if(tool.isDestructive&&requireConfirmation&&!confirmed)throw new ToolFailure(400,"Explicit user confirmation is required. Submit confirm: true after approval.");
  if(signal.aborted)throw new ToolFailure(400,"Request cancelled.");
  const parsed=tool.schema.safeParse(args);if(!parsed.success)throw new ToolFailure(400,"Invalid tool arguments: "+parsed.error.issues.map(issue=>issue.path.join(".")+": "+issue.message).join("; "));
  const boundary=createOperationBoundary(verify,capture);
  const dependencies=(createRouteDependencies as unknown as (...values:unknown[])=>ReturnType<typeof createRouteDependencies>)(connection,boundary,headers,storage);
  const modules=dependencies.modules as unknown as Record<string,Module>;
  return boundary.run(headers,async operationContext=>{
   const current=operationContext.principal;if(!current || !permitted(current,tool))throw new ToolFailure(403,"Required permissions are missing.");
   return tool.execute(parsed.data,{principal:current,operationContext,signal,async invoke(module,operation,input){
    const target=modules[module];if(!target || !Object.hasOwn(target.operations,operation))throw new ToolFailure(404,"Unknown operation.");
    const denied=target.checkAccess(operation,operationContext);if(denied)throw new ApplicationFailure(denied);
    const result=await target.operations[operation](input as never,operationContext);if(!result.ok)throw new ApplicationFailure(result.error);return result.value;
   }});
  });
 },
 };
}
export function mcpArguments(value:unknown){const input=z.record(z.unknown()).parse(value??{});const {confirm,...args}=input;return {args,confirmed:confirm===true};}
`;
export const aiModelSource = `import {createOpenAI} from "@ai-sdk/openai";
import {createAnthropic} from "@ai-sdk/anthropic";
import {createGoogleGenerativeAI} from "@ai-sdk/google";
import {createGroq} from "@ai-sdk/groq";
export interface AiEnvironment {OPENAI_API_KEY?:string;ANTHROPIC_API_KEY?:string;GEMINI_API_KEY?:string;GROQ_API_KEY?:string;AI_MODEL?:string;}
export function selectModel(env:AiEnvironment){
 if(env.OPENAI_API_KEY?.trim())return createOpenAI({apiKey:env.OPENAI_API_KEY})(env.AI_MODEL?.trim()||"gpt-4o-mini");
 if(env.ANTHROPIC_API_KEY?.trim())return createAnthropic({apiKey:env.ANTHROPIC_API_KEY})(env.AI_MODEL?.trim()||"claude-3-5-sonnet-latest");
 if(env.GEMINI_API_KEY?.trim())return createGoogleGenerativeAI({apiKey:env.GEMINI_API_KEY})(env.AI_MODEL?.trim()||"gemini-1.5-flash");
 if(env.GROQ_API_KEY?.trim())return createGroq({apiKey:env.GROQ_API_KEY})(env.AI_MODEL?.trim()||"openai/gpt-oss-20b");
 throw Error("Configure OPENAI_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY or GROQ_API_KEY on the backend to enable AI chat.");
}
`;
