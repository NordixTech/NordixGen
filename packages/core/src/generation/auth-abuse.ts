/** Shared persistent counters. Rows are locked in key order, independently of IP/Worker. */
export const authAbuseStore = String.raw`import {Client} from "@neondatabase/serverless";
export interface LimitRule {key:string;max:number;window:number;initialDelay?:number;multiplier?:number;maxDelay?:number;}
export interface LimitState {count:number;windowStart:number;lastRequest:number;}
export function decideLimit(rule:LimitRule,state:LimitState,now:number){
 const active=now-state.windowStart<rule.window*1000;
 const count=active?state.count:0;
 const delay=count?Math.min(rule.maxDelay??0,(rule.initialDelay??0)*Math.pow(rule.multiplier??1,count-1)):0;
 const wait=count>=rule.max?state.windowStart+rule.window*1000-now:active&&count?state.lastRequest+delay*1000-now:0;
 return {retryAfter:Math.max(0,Math.ceil(wait/1000)),count:count+1,windowStart:active&&count?state.windowStart:now,nextDelay:Math.min(rule.maxDelay??0,(rule.initialDelay??0)*Math.pow(rule.multiplier??1,count))};
}
export async function consumeLimits(connectionString:string,rules:readonly LimitRule[]):Promise<{retryAfter:number;nextDelay:number}>{
 if(!rules.length)return {retryAfter:0,nextDelay:0};
 const client=new Client({connectionString,connectionTimeoutMillis:10000});
 const localProxy=process.env.NEON_HTTP_PROXY_URL,hostname=new URL(connectionString).hostname;
 if(localProxy||hostname.endsWith(".localtest.me")){
  const endpoint=new URL(localProxy??"http://127.0.0.1:4444/sql");
  if(endpoint.protocol!=="http:"||endpoint.username||endpoint.password)throw Error("Invalid local database proxy");
  client.neonConfig.wsProxy=()=>endpoint.host+"/v2";client.neonConfig.useSecureWebSocket=false;client.neonConfig.pipelineConnect=false;
 }
 try{
  await client.connect();await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
  await client.query("SET LOCAL lock_timeout='5s'");await client.query("SET LOCAL statement_timeout='10s'");
  const ordered=[...rules].sort((a,b)=>a.key.localeCompare(b.key));
  const states:LimitState[]=[];
  for(const rule of ordered){
   await client.query('INSERT INTO auth_abuse_limit (key,count,window_start,last_request) VALUES ($1,0,0,0) ON CONFLICT (key) DO NOTHING',[rule.key]);
   const result=await client.query('SELECT count,window_start,last_request FROM auth_abuse_limit WHERE key=$1 FOR UPDATE',[rule.key]);
   const row=result.rows[0];states.push({count:Number(row.count),windowStart:Number(row.window_start),lastRequest:Number(row.last_request)});
  }
  const clock=await client.query('SELECT floor(extract(epoch FROM clock_timestamp())*1000)::bigint AS now');
  const now=Number(clock.rows[0].now),decisions=ordered.map((rule,i)=>decideLimit(rule,states[i],now));
  const retryAfter=Math.max(...decisions.map(d=>d.retryAfter));
  if(retryAfter){await client.query("ROLLBACK");return {retryAfter,nextDelay:0};}
  for(let i=0;i<ordered.length;i++){const d=decisions[i];await client.query('UPDATE auth_abuse_limit SET count=$2,window_start=$3,last_request=$4 WHERE key=$1',[ordered[i].key,d.count,d.windowStart,now]);}
  await client.query("COMMIT");return {retryAfter:0,nextDelay:Math.max(...decisions.map(d=>d.nextDelay))};
 }catch(error){await client.query("ROLLBACK").catch(()=>{});throw error;}finally{await client.end();}
}
`;

export const authAbusePlugin = String.raw`import type {BetterAuthPlugin} from "better-auth";
import {APIError,createAuthMiddleware,getSessionFromCtx} from "better-auth/api";
import {consumeLimits,type LimitRule} from "./abuse-store.js";
export interface AbuseOptions {connectionString:string;secret:string;account:{enabled:boolean;window:number;max:number};sms:{dailyLimit:number;initialDelay:number;multiplier:number;maxDelay:number};}
export async function privateLimitKey(secret:string,prefix:string,value:string):Promise<string>{
 const bytes=new TextEncoder();const key=await crypto.subtle.importKey("raw",bytes.encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
 const signature=await crypto.subtle.sign("HMAC",key,bytes.encode(prefix+":"+value));
 return prefix+":"+Array.from(new Uint8Array(signature),n=>n.toString(16).padStart(2,"0")).join("");
}
export function nordixAbuseProtection(options:AbuseOptions){
 return {id:"nordix-abuse-protection",hooks:{before:[{matcher:ctx=>["/sign-in/email","/sign-in/username","/phone-number/verify","/phone-number/send-otp"].includes(ctx.path??""),handler:createAuthMiddleware(async ctx=>{
  const sms=ctx.path==="/phone-number/send-otp";
  const phone=typeof ctx.body?.phoneNumber==="string"?ctx.body.phoneNumber:"";
  const phoneRoute=ctx.path.startsWith("/phone-number/");
  if(phoneRoute&&!/^\+[1-9][0-9]{7,14}$/.test(phone))return;
  const session=sms?await getSessionFromCtx(ctx):null;
  let rules:LimitRule[]=[];
  if(sms){
   const policy={max:options.sms.dailyLimit,window:86400,initialDelay:options.sms.initialDelay,multiplier:options.sms.multiplier,maxDelay:options.sms.maxDelay};
   rules=[{...policy,key:await privateLimitKey(options.secret,"sms-phone",phone)}];
   if(session?.user.id)rules.push({...policy,key:await privateLimitKey(options.secret,"sms-user",session.user.id)});
  }else if(options.account.enabled&&!(phoneRoute&&ctx.body?.updatePhoneNumber===true)){
   const field=phoneRoute?"phoneNumber":ctx.path==="/sign-in/username"?"username":"email";
   const raw=phoneRoute?phone:ctx.body?.[field];if(typeof raw!=="string"||!raw.trim())return;
   const value=raw.trim().toLowerCase();
   const user=await ctx.context.adapter.findOne<{id:string}>({model:"user",where:[{field,value}]});
   const identity=user?"user:"+user.id:field+":"+value;
   rules=[{key:await privateLimitKey(options.secret,"login-account",identity),max:options.account.max,window:options.account.window}];
  }
  let result:{retryAfter:number;nextDelay:number};
  try{result=await consumeLimits(options.connectionString,rules);}catch{throw new APIError("SERVICE_UNAVAILABLE",{message:"Authentication protection is temporarily unavailable. Please try again later."});}
  if(result.retryAfter)throw new APIError("TOO_MANY_REQUESTS",{code:sms?"SMS_LIMIT_REACHED":"ACCOUNT_RATE_LIMITED",message:sms?"Please wait before requesting another SMS code.":"Too many sign-in attempts for this account. Please try again later.",retryAfter:result.retryAfter},{"Retry-After":String(result.retryAfter),"X-Retry-After":String(result.retryAfter)});
  if(sms)return {context:{context:{smsRetryAfter:result.nextDelay}}};
 })}],after:[{matcher:ctx=>ctx.path==="/phone-number/send-otp",handler:createAuthMiddleware(async ctx=>{
  const delay=(ctx.context as typeof ctx.context & {smsRetryAfter?:number}).smsRetryAfter;
  if(delay)ctx.setHeader("X-SMS-Retry-After",String(delay));
 })}]}} satisfies BetterAuthPlugin;
}
`;
