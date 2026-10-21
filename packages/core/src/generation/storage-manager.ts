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
import {StorageConflictError} from "./cloudflare-r2-adapter.js";
export interface StoragePrincipal{id:string;permissions:readonly string[];}
type StorageContext<E extends StorageEnvironment>=Context<{Bindings:E;Variables:{storagePrincipal:StoragePrincipal}}>;
const instances=__STORAGE_INSTANCES__ as {key:string;backend:string;visibility:string}[];
export const MAX_UPLOAD_BYTES=10*1024*1024;
const permits=(principal:StoragePrincipal,key:string,action:"read"|"write")=>principal.permissions.includes("*")||principal.permissions.includes("storage:"+key+":"+action);
function objectKey(value:unknown):string{
 if(typeof value!=="string"||!value||new TextEncoder().encode(value).length>1024||value.startsWith("/")||value.includes("\\")||value.split("/").some(part=>part==="."||part==="..")||/[\x00-\x1f\x7f]/.test(value))throw new HTTPException(400,{message:"A valid object key is required."});
 return value;
}
async function uploadBytes(request:Request):Promise<Uint8Array>{
 if(Number(request.headers.get("content-length"))>MAX_UPLOAD_BYTES)throw new HTTPException(413,{message:"Files must be 10 MB or smaller."});
 if(!request.body)throw new HTTPException(400,{message:"Choose a file to upload."});
 const reader=request.body.getReader();const chunks:Uint8Array[]=[];let size=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_UPLOAD_BYTES){await reader.cancel();throw new HTTPException(413,{message:"Files must be 10 MB or smaller."});}chunks.push(value);}}finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}return bytes;
}
export function createStorageRoutes<E extends StorageEnvironment>(verify:(context:StorageContext<E>)=>Promise<StoragePrincipal|null>,trusted:(origin:string,env:E)=>boolean){
 const routes=new Hono<{Bindings:E;Variables:{storagePrincipal:StoragePrincipal}}>();
 routes.onError((error,c)=>error instanceof StorageConflictError?problemResponse(c,409,"Conflict",error.message):error instanceof HTTPException?problemResponse(c,error.status,"Storage request failed",error.message):problemResponse(c,500,"Storage unavailable","The storage request could not be completed."));
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
  const action=c.req.method==="PUT"?"write":"read";
  if(!permits(c.get("storagePrincipal"),key,action))return problemResponse(c,403,"Forbidden","Your account cannot perform this storage operation.");
  await next();
 });
 routes.get("/api/storage/:storage/objects",async c=>{
  const cursor=c.req.query("cursor"),prefix=c.req.query("prefix")??"";
  if((cursor?.length??0)>2048||prefix.length>1024)throw new HTTPException(400,{message:"Invalid listing parameters."});
  const storage=createStorage(c.env)[c.req.param("storage")];
  return c.json(await storage.list({cursor,prefix,limit:50}));
 });
 routes.put("/api/storage/:storage/objects",async c=>{
  const key=objectKey(c.req.query("key"));const storage=createStorage(c.env)[c.req.param("storage")];
  if(await storage.exists(key))throw new HTTPException(409,{message:"A file with this name already exists. Choose another name."});
  const bytes=await uploadBytes(c.req.raw);
  await storage.upload(key,bytes,c.req.header("content-type")??"application/octet-stream",{onlyIfAbsent:true});
  return c.json({key,size:bytes.byteLength},201);
 });
 routes.get("/api/storage/:storage/download",async c=>{
  const key=objectKey(c.req.query("key"));const object=await createStorage(c.env)[c.req.param("storage")].downloadStream(key);
  if(!object)return problemResponse(c,404,"Not Found","File not found.");
  const filename=encodeURIComponent(key.split("/").pop()??"download").replace(/['()*]/g,char=>"%"+char.charCodeAt(0).toString(16).toUpperCase());
  return new Response(object.body,{headers:{"Content-Type":object.contentType,"Content-Disposition":"attachment; filename*=UTF-8''"+filename,"X-Content-Type-Options":"nosniff","Content-Security-Policy":"sandbox; default-src 'none'","Cache-Control":"private, no-store",...(object.size===undefined?{}:{"Content-Length":String(object.size)}),...(object.etag?{ETag:object.etag}:{})}});
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
