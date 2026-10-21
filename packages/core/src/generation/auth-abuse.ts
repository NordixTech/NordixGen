import { abuseFunctionSql } from "./abuse-function.js";
/** Shared persistent counters. Rows are locked in key order, independently of IP/Worker. */
export const authAbuseStore = String.raw`import {neon,neonConfig} from "@neondatabase/serverless";
export const installAbuseFunctionSql=__ABUSE_SQL__;
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
 const proxy=typeof process!=="undefined"?process.env.NEON_HTTP_PROXY_URL:undefined;
 if(proxy||new URL(connectionString).hostname.endsWith(".localtest.me")){
  const endpoint=new URL(proxy??"http://127.0.0.1:4444/sql");
  if(endpoint.protocol!=="http:"||endpoint.username||endpoint.password)throw Error("Invalid local Neon endpoint");
  neonConfig.fetchEndpoint=endpoint.href;
 }
 const query=neon(connectionString,{fetchOptions:{signal:AbortSignal.timeout(15000)}});
 const rows=await query('SELECT * FROM public.nordix_consume_limits($1::jsonb)',[JSON.stringify(rules)]);
 const result=rows[0];if(!result)throw Error("Authentication limits unavailable");
 return {retryAfter:Number(result.retryAfter),nextDelay:Number(result.nextDelay)};
}
`.replace("__ABUSE_SQL__", JSON.stringify(abuseFunctionSql));

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
