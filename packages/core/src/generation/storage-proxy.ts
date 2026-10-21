/** Run file delivery before the Next/Node response bridge. Keep the native R2 stream intact. */
export const storageProxySource = String.raw`type StorageService={fetch(request:Request):Promise<Response>};
export async function proxyStorageDownload(request:Request,env:Record<string,unknown>,bindings:Readonly<Record<string,string>>):Promise<Response|null>{
 const url=new URL(request.url);
 const match=/^\/api\/backend\/([^/]+)\/api\/storage\/([^/]+)\/download$/.exec(url.pathname);
 if(!match)return null;
 const binding=Object.hasOwn(bindings,match[1])?bindings[match[1]]:undefined;
 if(!binding)return new Response(null,{status:404});
 if(!["GET","HEAD"].includes(request.method))return new Response(null,{status:405,headers:{Allow:"GET, HEAD","Cache-Control":"private, no-store"}});
 const service=env[binding] as StorageService|undefined;
 if(!service)return Response.json({title:"Backend unavailable",status:503},{status:503,headers:{"Cache-Control":"private, no-store"}});
 const headers=new Headers(request.headers);
 for(const name of ["host","connection","content-length","forwarded","x-forwarded-host","x-forwarded-proto","x-nordix-client-ip","x-nordix-mcp-gateway"])headers.delete(name);
 headers.set("x-nordix-client-ip",request.headers.get("cf-connecting-ip")??"unknown");
 headers.set("accept-encoding","identity");
 url.pathname="/api/storage/"+match[2]+"/download";
 try{
  // The private backend verifies the session and current storage grants on every request.
  const response=await service.fetch(new Request(url,{method:request.method,headers,redirect:"manual",signal:request.signal}));
  const forwarded=new Headers(response.headers);
  forwarded.delete("connection");forwarded.set("Cache-Control","private, no-store");
  // No arrayBuffer, reader, TransformStream, or JavaScript loop over file chunks.
  // Preserve Content-Length so interrupted transfers cannot look like complete files.
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers:forwarded});
 }catch{
  return Response.json({title:"Backend unavailable",status:503},{status:503,headers:{"Cache-Control":"private, no-store"}});
 }
}
`;
