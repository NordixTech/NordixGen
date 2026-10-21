import type { GeneratedFile } from "../plugins/contracts.js";
import type { ResolvedProject } from "../project/types.js";

/** A protected platform surface; public buckets do not grant dashboard access. */
export function storageManagerFile(project: ResolvedProject, backend: string): GeneratedFile {
  const app = project.backends[backend];
  const instances = app.storage.map((key) => ({
    key,
    backend,
    visibility: project.iac?.cloudflare.r2_storage[key]?.visibility ?? "private",
  }));
  return {
    path: `${app.path}/src/platform/storage/routes.ts`,
    content: storageRoutesSource.replace("__STORAGE_INSTANCES__", JSON.stringify(instances)),
  };
}

export const storageRoutesSource = String.raw`import {Hono,type Context} from "hono";
import {HTTPException} from "hono/http-exception";
import {createStorage,type StorageEnvironment} from "./create-storage.js";
import {problemResponse} from "../http/problem-details.js";
import {StorageConflictError,StorageRangeError} from "./cloudflare-r2-adapter.js";
export interface StoragePrincipal{id:string;permissions:readonly string[];}
type StorageContext<E extends StorageEnvironment>=Context<{Bindings:E;Variables:{storagePrincipal:StoragePrincipal}}>;
const instances=__STORAGE_INSTANCES__ as {key:string;backend:string;visibility:string}[];
export const MAX_UPLOAD_BYTES=100*1024*1024;
const permits=(principal:StoragePrincipal,key:string,action:"read"|"write")=>principal.permissions.includes("*")||principal.permissions.includes("storage:"+key+":"+action);
function objectKey(value:unknown):string{
 if(typeof value!=="string"||!value||new TextEncoder().encode(value).length>1024||value.startsWith("/")||value.includes("\\")||value.split("/").some(part=>part==="."||part==="..")||/[\x00-\x1f\x7f]/.test(value))throw new HTTPException(400,{message:"A valid object key is required."});
 return value;
}
export function createStorageRoutes<E extends StorageEnvironment>(verify:(context:StorageContext<E>)=>Promise<StoragePrincipal|null>,trusted:(origin:string,env:E)=>boolean){
 const routes=new Hono<{Bindings:E;Variables:{storagePrincipal:StoragePrincipal}}>();
 routes.onError((error,c)=>{if(error instanceof StorageRangeError){c.header("Content-Range","bytes */"+error.size);c.header("Accept-Ranges","bytes");return problemResponse(c,416,"Range not satisfiable",error.message);}return error instanceof StorageConflictError?problemResponse(c,409,"Conflict",error.message):error instanceof HTTPException?problemResponse(c,error.status,"Storage request failed",error.message):problemResponse(c,500,"Storage unavailable","The storage request could not be completed.");});
 routes.use("/api/storage/*",async(c,next)=>{
  c.header("Cache-Control","private, no-store");
  const principal=await verify(c);if(!principal)return problemResponse(c,401,"Unauthorized","Sign in to manage storage.");
  c.set("storagePrincipal",principal);
  if(["POST","PUT","PATCH","DELETE"].includes(c.req.method)&&!trusted(c.req.header("origin")??"",c.env))return problemResponse(c,403,"Forbidden","A trusted Origin header is required.");
  await next();
 });
 routes.get("/api/storage/instances",c=>{
  const principal=c.get("storagePrincipal");const buckets=JSON.parse(c.env.R2_BUCKETS??"{}") as Record<string,string>;
  return c.json({instances:instances.filter(item=>permits(principal,item.key,"read")||permits(principal,item.key,"write")).map(item=>({...item,canRead:permits(principal,item.key,"read"),canUpload:permits(principal,item.key,"write"),signedDownloads:Boolean(c.env.R2_ACCOUNT_ID&&c.env.R2_ACCESS_KEY_ID&&c.env.R2_SECRET_ACCESS_KEY&&buckets[item.key]),maxUploadBytes:MAX_UPLOAD_BYTES}))});
 });
 routes.use("/api/storage/:storage/*",async(c,next)=>{
  const key=c.req.param("storage");if(!instances.some(item=>item.key===key))return problemResponse(c,404,"Not Found","Storage instance not found.");
  const action=c.req.method==="PUT"||c.req.path.endsWith("/upload-url")?"write":"read";
  if(!permits(c.get("storagePrincipal"),key,action))return problemResponse(c,403,"Forbidden","Your account cannot perform this storage operation.");
  await next();
 });
 routes.get("/api/storage/:storage/objects",async c=>{
  const cursor=c.req.query("cursor"),prefix=c.req.query("prefix")??"";
  if((cursor?.length??0)>2048||prefix.length>1024)throw new HTTPException(400,{message:"Invalid listing parameters."});
  const storage=createStorage(c.env)[c.req.param("storage")];
  return c.json(await storage.list({cursor,prefix,limit:50}));
 });
 routes.put("/api/storage/:storage/objects",c=>problemResponse(c,410,"Direct upload required","Request an upload-url and send the file directly to R2."));
 routes.post("/api/storage/:storage/upload-url",async c=>{
  if(Number(c.req.header("content-length"))>4096)throw new HTTPException(413,{message:"Upload metadata is too large."});
  // Bound metadata even when Content-Length is absent. File bytes never enter this route.
  const reader=c.req.raw.body?.getReader();if(!reader)throw new HTTPException(400,{message:"Upload metadata is required."});
  let text="",length=0;const decoder=new TextDecoder();
  try{while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>4096){await reader.cancel();throw new HTTPException(413,{message:"Upload metadata is too large."});}text+=decoder.decode(value,{stream:true});}text+=decoder.decode();}finally{reader.releaseLock();}
  let body:{key?:unknown;size?:unknown;contentType?:unknown};try{body=JSON.parse(text);if(!body||typeof body!=="object")throw Error();}catch{throw new HTTPException(400,{message:"Send file key, size and contentType as JSON."});}
  const key=objectKey(body.key);
  if(typeof body.size!=="number"||!Number.isSafeInteger(body.size)||body.size<0)throw new HTTPException(400,{message:"A valid file size is required."});
  if(body.size>MAX_UPLOAD_BYTES)throw new HTTPException(413,{message:"Files must be 100 MB or smaller."});
  if(typeof body.contentType!=="string"||!body.contentType||body.contentType.length>255||/[\r\n]/.test(body.contentType))throw new HTTPException(400,{message:"A valid content type is required."});
  const bucket=c.req.param("storage");const names=JSON.parse(c.env.R2_BUCKETS??"{}") as Record<string,string>;
  if(!c.env.R2_ACCOUNT_ID||!c.env.R2_ACCESS_KEY_ID||!c.env.R2_SECRET_ACCESS_KEY||!names[bucket])return problemResponse(c,503,"Signing unavailable","Direct uploads are not configured for this instance.");
  const storage=createStorage(c.env)[bucket];
  if(await storage.exists(key))throw new HTTPException(409,{message:"A file with this name already exists. Choose another name."});
  return c.json({key,size:body.size,method:"PUT",...await storage.getUploadUrl(key,body.size,body.contentType,300),expiresIn:300});
 });
 routes.get("/api/storage/:storage/download",async c=>{
  const key=objectKey(c.req.query("key"));const object=await createStorage(c.env)[c.req.param("storage")].downloadStream(key,c.req.method==="GET"?{range:c.req.header("range"),ifRange:c.req.header("if-range")}:undefined);
  if(!object)return problemResponse(c,404,"Not Found","File not found.");
  const filename=encodeURIComponent(key.split("/").pop()??"download").replace(/['()*]/g,char=>"%"+char.charCodeAt(0).toString(16).toUpperCase());
  return new Response(object.body,{status:object.range?206:200,headers:{"Accept-Ranges":"bytes",...(object.range?{"Content-Range":"bytes "+object.range.offset+"-"+(object.range.offset+object.range.length-1)+"/"+object.range.total}:{}),"Content-Type":object.contentType,"Content-Disposition":"attachment; filename*=UTF-8''"+filename,"X-Content-Type-Options":"nosniff","Content-Security-Policy":"sandbox; default-src 'none'","Cache-Control":"private, no-store",...(object.size===undefined?{}:{"Content-Length":String(object.size)}),...(object.etag?{ETag:object.etag}:{})}});
 });
 routes.post("/api/storage/:storage/signed-url",async c=>{
  let body:unknown;try{body=await c.req.json();}catch{throw new HTTPException(400,{message:"Send a JSON object with a file key."});}
  const key=objectKey(body&&typeof body==="object"&&"key"in body?body.key:undefined);
  const bucket=c.req.param("storage");const names=JSON.parse(c.env.R2_BUCKETS??"{}") as Record<string,string>;
  if(!c.env.R2_ACCOUNT_ID||!c.env.R2_ACCESS_KEY_ID||!c.env.R2_SECRET_ACCESS_KEY||!names[bucket])return problemResponse(c,503,"Signing unavailable","Signed downloads are not configured for this instance. Use backend download.");
  const storage=createStorage(c.env)[bucket];if(!await storage.exists(key))return problemResponse(c,404,"Not Found","File not found.");
  return c.json({url:await storage.getSignedUrl(key,300),expiresIn:300});
 });
 return routes;
}
`;
