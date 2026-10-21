import type { GeneratedFile } from "../plugins/contracts.js";
import type { ResolvedProject } from "../project/types.js";
import { storageManagerFile } from "./storage-manager.js";

const port = `export type StorageBody=ReadableStream<Uint8Array>|ArrayBuffer|Uint8Array;
export interface StorageDownload {body:ReadableStream<Uint8Array>;contentType:string;etag?:string;size?:number;}
/** Authorization belongs to the calling use case/controller, before invoking this port. */
export interface StorageObject {key:string;size:number;uploaded:string;etag:string;}
export interface StoragePage {objects:StorageObject[];cursor?:string;}
export interface StoragePort {
 list(options?:{cursor?:string;prefix?:string;limit?:number}):Promise<StoragePage>;
 upload(key:string,data:StorageBody,contentType:string,options?:{onlyIfAbsent?:boolean}):Promise<void>;
 downloadStream(key:string):Promise<StorageDownload|null>;
 getSignedUrl(key:string,expiresInSeconds?:number):Promise<string>;
 getPublicUrl(key:string):Promise<string|null>;
 delete(key:string):Promise<void>;
 exists(key:string):Promise<boolean>;
}
`;
const adapter = String.raw`import type {StoragePort,StorageBody,StorageDownload,StoragePage} from "../../application/ports/storage-port.js";
export interface R2Binding {
 list(options:{cursor?:string;prefix?:string;limit:number}):Promise<{objects:{key:string;size:number;uploaded:Date;etag:string}[];truncated:boolean;cursor?:string}>;
 put(key:string,data:StorageBody,options:{httpMetadata:{contentType:string};onlyIf?:{etagDoesNotMatch:string}}):Promise<unknown>;
 get(key:string):Promise<{body:ReadableStream<Uint8Array>;httpMetadata?:{contentType?:string};httpEtag?:string;size?:number}|null>;
 head(key:string):Promise<unknown|null>;
 delete(key:string):Promise<void>;
}
export interface R2Signing {accountId:string;bucket:string;accessKeyId:string;secretAccessKey:string;}
const encoder=new TextEncoder();
const hex=(data:ArrayBuffer)=>Array.from(new Uint8Array(data),byte=>byte.toString(16).padStart(2,"0")).join("");
const encode=(value:string)=>encodeURIComponent(value).replace(/[!'()*]/g,char=>"%"+char.charCodeAt(0).toString(16).toUpperCase());
async function hmac(key:Uint8Array|string,message:string):Promise<ArrayBuffer>{
 const imported=await crypto.subtle.importKey("raw",typeof key==="string"?encoder.encode(key):key as Uint8Array<ArrayBuffer>,{name:"HMAC",hash:"SHA-256"},false,["sign"]);
 return crypto.subtle.sign("HMAC",imported,encoder.encode(message));
}
export class StorageConflictError extends Error {constructor(){super("A file with this name already exists. Choose another name.");this.name="StorageConflictError";}}
/** A native binding serves data; S3 credentials are used only to sign direct download links. */
export class CloudflareR2Adapter implements StoragePort {
 constructor(private readonly bucket:R2Binding,private readonly signing?:R2Signing,private readonly publicUrl?:string){}
 private key(key:string){if(!key||key.startsWith("/")||key.split("/").some(part=>part==="."||part==="..")||/[\x00-\x1f]/.test(key))throw Error("Invalid storage key");return key;}
 async list(options:{cursor?:string;prefix?:string;limit?:number}={}):Promise<StoragePage>{const result=await this.bucket.list({...options,limit:Math.max(1,Math.min(options.limit??50,100))});return {objects:result.objects.map(item=>({key:item.key,size:item.size,uploaded:item.uploaded.toISOString(),etag:item.etag})),...(result.truncated?{cursor:result.cursor}:{})};}
 async upload(key:string,data:StorageBody,contentType:string,options?:{onlyIfAbsent?:boolean}){const result=await this.bucket.put(this.key(key),data,{httpMetadata:{contentType},...(options?.onlyIfAbsent?{onlyIf:{etagDoesNotMatch:"*"}}:{})});if(result===null)throw new StorageConflictError();}
 async downloadStream(key:string):Promise<StorageDownload|null>{const object=await this.bucket.get(this.key(key));return object?{body:object.body,contentType:object.httpMetadata?.contentType??"application/octet-stream",etag:object.httpEtag,size:object.size}:null;}
 async delete(key:string){await this.bucket.delete(this.key(key));}
 async exists(key:string){return (await this.bucket.head(this.key(key)))!==null;}
 async getPublicUrl(key:string){return this.publicUrl?this.publicUrl.replace(/\/$/,"")+"/"+this.key(key).split("/").map(encode).join("/"):null;}
 async getSignedUrl(key:string,expiresInSeconds=300):Promise<string>{
  this.key(key);if(!Number.isInteger(expiresInSeconds)||expiresInSeconds<1||expiresInSeconds>604800)throw Error("Expiry must be between 1 and 604800 seconds");
  const config=this.signing;if(!config?.accessKeyId||!config.secretAccessKey)throw Error("R2 download signing is not configured");
  const host=config.accountId+".r2.cloudflarestorage.com";
  const date=new Date().toISOString().replace(/[:-]|\.\d{3}/g,"");const day=date.slice(0,8);const scope=day+"/auto/s3/aws4_request";
  const pathname="/"+encode(config.bucket)+"/"+key.split("/").map(encode).join("/");
  const params:Record<string,string>={"X-Amz-Algorithm":"AWS4-HMAC-SHA256","X-Amz-Credential":config.accessKeyId+"/"+scope,"X-Amz-Date":date,"X-Amz-Expires":String(expiresInSeconds),"X-Amz-SignedHeaders":"host"};
  const query=Object.keys(params).sort().map(key=>encode(key)+"="+encode(params[key])).join("&");
  const canonical=["GET",pathname,query,"host:"+host+"\n","host","UNSIGNED-PAYLOAD"].join("\n");
  const toSign=["AWS4-HMAC-SHA256",date,scope,hex(await crypto.subtle.digest("SHA-256",encoder.encode(canonical)))].join("\n");
  let signingKey=await hmac("AWS4"+config.secretAccessKey,day);
  for(const part of ["auto","s3","aws4_request"])signingKey=await hmac(new Uint8Array(signingKey),part);
  return "https://"+host+pathname+"?"+query+"&X-Amz-Signature="+hex(await hmac(new Uint8Array(signingKey),toSign));
 }
}
`;
export function storageFiles(project: ResolvedProject, backend: string): GeneratedFile[] {
  const app = project.backends[backend];
  if (!app.storage.length) return [];
  const root = `${app.path}/src`;
  return [
    storageManagerFile(project, backend),
    { path: `${root}/application/ports/storage-port.ts`, content: port },
    { path: `${root}/platform/storage/cloudflare-r2-adapter.ts`, content: adapter },
    {
      path: `${root}/platform/storage/create-storage.ts`,
      content: `import {CloudflareR2Adapter,type R2Binding} from "./cloudflare-r2-adapter.js";
import type {StoragePort} from "../../application/ports/storage-port.js";
export interface StorageEnvironment {${app.storage.map((key) => `${key.toUpperCase()}:R2Binding;`).join("")} R2_ACCOUNT_ID?:string;R2_ACCESS_KEY_ID?:string;R2_SECRET_ACCESS_KEY?:string;R2_BUCKETS?:string;R2_BINDINGS?:string;R2_PUBLIC_URLS?:string;}
export type StoragePorts=Readonly<Record<string,StoragePort>>;
export function createStorage(env:StorageEnvironment):StoragePorts{
 const buckets=JSON.parse(env.R2_BUCKETS??"{}") as Record<string,string>;
 const urls=JSON.parse(env.R2_PUBLIC_URLS??"{}") as Record<string,string>;
 const bindings=JSON.parse(env.R2_BINDINGS??${JSON.stringify(JSON.stringify(Object.fromEntries(app.storage.map((key) => [key, key.toUpperCase()]))))}) as Record<string,string>;
 return Object.freeze(Object.fromEntries(Object.entries(bindings).map(([key,binding])=>{
  const bucket=(env as unknown as Record<string,R2Binding>)[binding];
  if(!bucket)throw Error("R2 binding is missing: "+binding);
  return [key,new CloudflareR2Adapter(bucket,env.R2_ACCOUNT_ID&&env.R2_ACCESS_KEY_ID&&env.R2_SECRET_ACCESS_KEY?{accountId:env.R2_ACCOUNT_ID,bucket:buckets[key],accessKeyId:env.R2_ACCESS_KEY_ID,secretAccessKey:env.R2_SECRET_ACCESS_KEY}:undefined,urls[key])];
 })));
}
`,
    },
  ];
}
