import { DEFAULT_PASSWORD_POLICY, type PasswordPolicy } from "../project/account-policy.js";

/** The identical public credential validator is emitted for server hooks and browser forms. */
export function passwordPolicySource(
  policy: Readonly<PasswordPolicy> = DEFAULT_PASSWORD_POLICY,
): string {
  const effective = { ...policy };
  if (effective.numericOnly) {
    effective.requireUppercase = false;
    effective.requireLowercase = false;
    effective.requireNumber = false;
    effective.requireSpecialChar = false;
  }
  return `import {z} from "zod";
export const passwordPolicy=${JSON.stringify(effective)};
export const passwordSchema=z.string().min(passwordPolicy.minLength,{message:"Use at least "+passwordPolicy.minLength+" characters for your "+(passwordPolicy.numericOnly?"PIN.":"password.")}).max(passwordPolicy.maxLength,{message:"Use no more than "+passwordPolicy.maxLength+" characters."}).superRefine((value,ctx)=>{
 const reject=(message:string)=>ctx.addIssue({code:"custom",message});
 if(passwordPolicy.numericOnly){if(!/^[0-9]+$/.test(value))reject("Your PIN can only contain digits from 0 to 9.");return;}
 if(passwordPolicy.requireUppercase&&!/[A-Z]/.test(value))reject("Add an uppercase letter, for example A, B or C.");
 if(passwordPolicy.requireLowercase&&!/[a-z]/.test(value))reject("Add a lowercase letter, for example a, b or c.");
 if(passwordPolicy.requireNumber&&!/[0-9]/.test(value))reject("Add a number from 0 to 9.");
 if(passwordPolicy.requireSpecialChar&&!/[^A-Za-z0-9\\s]/.test(value))reject("Add a symbol, for example !, @, # or $. Spaces do not count as symbols.");
});
`;
}

export const authPolicyPlugin = String.raw`import type {BetterAuthPlugin} from "better-auth";
import {APIError,createAuthMiddleware,getSessionFromCtx} from "better-auth/api";
import {passwordSchema} from "./password-policy.js";
export function assertAllowedEmail(email:unknown,domains:readonly string[]):void {
 if(!domains.length)return;
 if(typeof email!=="string"||!domains.includes(email.split("@")[1]?.toLowerCase()??""))throw new APIError("BAD_REQUEST",{message:"Registration restricted to authorized company domains"});
}
export function nordixAuthPolicy(options:{domains:readonly string[];emailPassword:boolean;phone:boolean;emailDelivery?:()=>void;verifyEmail?:boolean}) {
 return {id:"nordix-auth-policy",hooks:{before:[{matcher:()=>true,handler:createAuthMiddleware(async ctx=>{
  if(!options.emailPassword&&["/sign-up/email","/sign-in/email","/set-password","/change-password","/reset-password","/request-password-reset"].includes(ctx.path))throw new APIError("BAD_REQUEST",{message:"Email/password authentication is disabled."});
  if(options.phone&&ctx.path==="/sign-in/phone-number")throw new APIError("BAD_REQUEST",{message:"Use SMS verification to sign in."});
  if(["/request-password-reset","/send-verification-email"].includes(ctx.path)||(options.verifyEmail&&ctx.path==="/sign-up/email"))options.emailDelivery?.();
  if(["/sign-up/email","/change-password","/set-password","/reset-password","/phone-number/reset-password"].includes(ctx.path)){
   const value=ctx.path==="/sign-up/email"?ctx.body?.password:ctx.body?.newPassword;
   const parsed=passwordSchema.safeParse(value);
   if(!parsed.success)throw new APIError("BAD_REQUEST",{message:parsed.error.issues[0].message});
  }
  if(ctx.path==="/sign-up/email")assertAllowedEmail(ctx.body?.email,options.domains);
  if(options.domains.length&&ctx.path==="/phone-number/verify"&&ctx.body?.updatePhoneNumber){
   const session=await getSessionFromCtx(ctx);
   if(!session?.user.emailVerified)throw new APIError("FORBIDDEN",{message:"Verify your company email before linking a phone number."});
   assertAllowedEmail(session.user.email,options.domains);
  }
  if(options.domains.length&&ctx.path==="/phone-number/verify"&&!ctx.body?.updatePhoneNumber){
   const user=await ctx.context.adapter.findOne<{email:string;emailVerified:boolean}>({model:"user",where:[{field:"phoneNumber",value:ctx.body?.phoneNumber}]});
   if(!user?.emailVerified)throw new APIError("FORBIDDEN",{message:"Register and verify your company email, then link your phone from your profile."});
   assertAllowedEmail(user.email,options.domains);
  }
 })}]}} satisfies BetterAuthPlugin;
}
`;
