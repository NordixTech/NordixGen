import type { BackendRenderContext, GeneratedFile } from "../plugins/contracts.js";
export function generateApplicationRuntime(
  context: BackendRenderContext,
): readonly GeneratedFile[] {
  return [
    {
      path: `${context.platformRoot}/application/contracts.ts`,
      content: `declare const trustedContext: unique symbol;
export interface Principal { readonly id:string; readonly role:string; readonly permissions?:readonly string[]; }
export interface OperationContext { readonly principal:Principal|null; readonly [trustedContext]:true; }
export type ApplicationErrorCode="validation"|"unauthorized"|"forbidden"|"not_found"|"conflict"|"unexpected";
export interface ApplicationError { readonly code:ApplicationErrorCode; readonly message:string; }
export type ApplicationResult<T>={readonly ok:true;readonly value:T}|{readonly ok:false;readonly error:ApplicationError};
/** Only deliberate safe application failures use this class. Raw exceptions are contained. */
export class ApplicationFailure extends Error { constructor(readonly error:ApplicationError){super(error.message);this.name="ApplicationFailure";} }
`,
    },
    {
      path: `${context.platformRoot}/application/access.ts`,
      content: `import type {ApplicationError,OperationContext,Principal} from "./contracts.js";
${context.identity ? 'import type {Permission} from "../authorization/policy.js";' : "type Permission=string;"}
export interface AccessPolicy {readonly authority?:string;readonly authenticated:boolean;readonly roles:readonly string[];readonly permissions:readonly Permission[];}
export type AccessGuard=(context:OperationContext,policy:AccessPolicy)=>ApplicationError|undefined;
export interface OperationBoundary {readonly authorize:AccessGuard;run<T>(headers:Headers,operation:(context:OperationContext)=>Promise<T>):Promise<T>;}
${context.identity ? 'import {isAuthorized} from "../authorization/policy.js";' : "const isAuthorized=(_principal:unknown,policy:AccessPolicy)=>policy.roles.length===0&&policy.permissions.length===0;"}
/** Constructed by backend entry/composition only. Consumers receive context, never an issuer. */
export function createOperationBoundary(verifySession:(headers:Headers)=>Promise<Principal|null>):OperationBoundary {
 const issued=new WeakSet<OperationContext>();
 const authorize:AccessGuard=(context,policy)=>{
  if(!issued.has(context))return {code:"unauthorized",message:"A trusted backend operation context is required."};
  if(policy.authenticated&&!context.principal)return {code:"unauthorized",message:"A verified session is required."};
  if(!isAuthorized(context.principal??{},policy))return {code:"forbidden",message:"Required roles or permissions are missing."};
  return undefined;
 };
 return {authorize,async run(headers,operation){
  const principal=await verifySession(headers);
  const context=Object.freeze({principal:principal?Object.freeze({id:principal.id,role:principal.role,permissions:Object.freeze([...(principal.permissions??[])])}):null}) as OperationContext;
  issued.add(context);
  try{return await operation(context);}finally{issued.delete(context);}
 }};
}
`,
    },
    {
      path: `${context.platformRoot}/http/application-error.ts`,
      content: `import type {Context} from "hono";
import {ApplicationFailure} from "../application/contracts.js";
import {problemResponse} from "./problem-details.js";
const statuses={validation:400,unauthorized:401,forbidden:403,not_found:404,conflict:409,unexpected:500} as const;
const titles={validation:"Validation Failed",unauthorized:"Unauthorized",forbidden:"Forbidden",not_found:"Not Found",conflict:"Conflict",unexpected:"Internal Server Error"} as const;
export function applicationProblem(c:Context,error:unknown):Response|undefined {
 if(!(error instanceof ApplicationFailure))return undefined;
 return problemResponse(c,statuses[error.error.code],titles[error.error.code],error.error.code==="unexpected"?"An unexpected error occurred":error.error.message);
}
`,
    },
  ];
}
