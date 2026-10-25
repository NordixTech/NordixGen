/** Cache configuration and route construction only; request identity and grants stay live. */
export const authInstancesSource = String.raw`import {AsyncLocalStorage} from "node:async_hooks";
interface Execution{waitUntil(task:Promise<unknown>):void;}
export function createAuthInstanceCache<Environment extends object,Auth extends {handler(request:Request):Promise<Response>;api:object}>(build:(env:Environment,execution:Execution)=>Auth){
 const execution=new AsyncLocalStorage<Execution|undefined>();
 const instances=new Map<string,Auth>();
 const auditExecution:Execution={waitUntil(task){execution.getStore()?.waitUntil(task);}};
 return (env:Environment,context?:Execution):Auth=>{
  // Worker bindings are not cache keys. All scalar environment settings participate in rotation.
  const key=JSON.stringify(Object.entries(env).filter(([,value])=>typeof value==="string").sort(([a],[b])=>a.localeCompare(b)));
  let instance=instances.get(key);
  if(!instance){instance=build({...env},auditExecution);if(instances.size>=4)instances.delete(instances.keys().next().value!);instances.set(key,instance);}
  const auth=instance;
  // AsyncLocalStorage keeps concurrent waitUntil ownership request-local, including API calls.
  return {...auth,handler:(request:Request)=>execution.run(context,()=>auth.handler(request)),api:new Proxy(auth.api,{get(target,property,receiver){const value=Reflect.get(target,property,receiver);if(typeof value!=="function")return value;return Object.assign((...args:unknown[])=>execution.run(context,()=>Reflect.apply(value,target,args)),value);}})};
 };
}
`;
