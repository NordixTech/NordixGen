import type { GeneratedFile } from "../plugins/contracts.js";
import type { ResolvedIdentity } from "../project/types.js";

const imports = `"use client";
import {useState,type FormEvent} from "react";
import {authClient} from "@/lib/auth/client";
import {useSessionView} from "@/lib/auth/use-session-view";
import {Input} from "@/components/ui/input";
import {Button} from "@/components/ui/button";
import {Notice} from "@/components/ui/notice";
`;
export function authJourneyFiles(root: string, identity: ResolvedIdentity): GeneratedFile[] {
  const files: GeneratedFile[] = [];
  if (identity.methods.includes("email-password")) {
    files.push(
      {
        path: `${root}/components/auth/forgot-password-form.tsx`,
        content: `${imports}
export function ForgotPasswordForm(){
 const {isPending:identityPending}=useSessionView();
 const [pending,setPending]=useState(false),[message,setMessage]=useState("");
 if(identityPending)return <Notice>Checking session...</Notice>;
 async function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();const form=new FormData(event.currentTarget);setPending(true);setMessage("");
 try{const result=await authClient.requestPasswordReset({email:String(form.get("email")),redirectTo:window.location.origin+"/reset-password"});setMessage(result.error?.message??"If an account exists, check your email for a password reset link.");}catch{setMessage("Could not reach the authentication service.");}finally{setPending(false);}}
 return <form className="ng-panel" onSubmit={submit}><h1>Recover your account</h1>{message&&<Notice>{message}</Notice>}<Input id="email" name="email" label="Email" type="email" autoComplete="email" required/><Button type="submit" disabled={pending}>Send reset link</Button><a href="/sign-in">Back to sign in</a></form>;
}
`,
      },
      {
        path: `${root}/components/auth/reset-password-form.tsx`,
        content: `${imports}
import {passwordSchema,passwordPolicy} from "@/lib/auth/password-policy";
export function ResetPasswordForm(){
 const {isPending:identityPending}=useSessionView();
 const [pending,setPending]=useState(false),[message,setMessage]=useState(""),[done,setDone]=useState(false);
 if(identityPending)return <Notice>Checking session...</Notice>;
 async function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();const form=new FormData(event.currentTarget),password=String(form.get("password")),parsed=passwordSchema.safeParse(password);setMessage("");
 if(!parsed.success){setMessage(parsed.error.issues[0].message);return;}if(password!==form.get("confirmPassword")){setMessage("Passwords do not match.");return;}
 const token=new URLSearchParams(window.location.search).get("token");if(!token){setMessage("This reset link is invalid. Request a new link.");return;}
 setPending(true);try{const result=await authClient.resetPassword({token,newPassword:password});if(result.error)setMessage(result.error.message??"Reset failed. Request a new link.");else{setDone(true);setMessage("Password updated. You can now sign in.");window.location.assign("/sign-in");}}catch{setMessage("Could not reach the authentication service.");}finally{setPending(false);}}
 return <form className="ng-panel" onSubmit={submit}><h1>Set your password</h1>{message&&<Notice>{message}</Notice>}{!done&&<><Input id="password" name="password" label={passwordPolicy.numericOnly?"New PIN":"New password"} type="password" inputMode={passwordPolicy.numericOnly?"numeric":undefined} autoComplete="new-password" minLength={passwordPolicy.minLength} maxLength={passwordPolicy.maxLength} required/><Input id="confirmPassword" name="confirmPassword" label="Confirm password / PIN" type="password" inputMode={passwordPolicy.numericOnly?"numeric":undefined} autoComplete="new-password" required/><Button type="submit" disabled={pending}>Save password</Button></>}<a href="/sign-in">Back to sign in</a></form>;
}
`,
      },
    );
    for (const [path, component] of [
      ["forgot-password", "ForgotPasswordForm"],
      ["reset-password", "ResetPasswordForm"],
    ])
      files.push({
        path: `${root}/app/${path}/page.tsx`,
        content: `import {${component}} from "@/components/auth/${path}-form";
export default function AuthPage(){return <main className="ng-shell"><${component}/></main>;}
`,
      });
  }
  if (identity.methods.includes("phone-number")) {
    files.push(
      {
        path: `${root}/components/auth/phone-form.tsx`,
        content: `${imports}
import {useRouter} from "next/navigation";
export function PhoneForm({link=false}:{link?:boolean}){
 const {isPending:identityPending}=useSessionView();
 const router=useRouter();const [phone,setPhone]=useState(""),[sent,setSent]=useState(false),[pending,setPending]=useState(false),[message,setMessage]=useState("");
 if(identityPending)return <Notice>Checking session...</Notice>;
 async function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();const form=new FormData(event.currentTarget);setPending(true);setMessage("");
 try{if(!sent){const result=await authClient.phoneNumber.sendOtp({phoneNumber:phone});if(result.error){setMessage(result.error.message??"Could not send code.");return;}setSent(true);setMessage("Enter the 6-digit code sent to your phone.");}
 else{const result=await authClient.phoneNumber.verify({phoneNumber:phone,code:String(form.get("code")),updatePhoneNumber:link,disableSession:link});if(result.error){setMessage(result.error.message??"Invalid verification code.");return;}
 if(link){setSent(false);setMessage("Phone number linked. You can use it to sign in.");}else{await authClient.getSession();router.replace("/");}router.refresh();}}
 catch{setMessage("Could not reach the authentication service.");}finally{setPending(false);}}
 return <form className="ng-panel" onSubmit={submit}><h2>{link?"Link your phone":"Continue with phone"}</h2>{message&&<Notice>{message}</Notice>}<Input id="phone" label="Phone number (e.g. +51999999999)" type="tel" autoComplete="tel" value={phone} onChange={event=>{setPhone(event.target.value);setSent(false);}} pattern="[+][1-9][0-9]{7,14}" required disabled={pending||sent}/>{sent&&<Input id="code" name="code" label="Verification code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" minLength={6} maxLength={6} required/>}<Button type="submit" disabled={pending}>{sent?"Verify code":"Send code"}</Button>{sent&&<Button type="button" variant="secondary" disabled={pending} onClick={()=>{setSent(false);setMessage("");}}>Change number / send another code</Button>}<p>${identity.allowedEmailDomains?.length ? "Company accounts must register and verify their email first. Sign in with a previously linked phone, or link a phone from your profile." : "Your phone is verified with a one-time code. No password is required."}</p></form>;
}
`,
      },
      {
        path: `${root}/app/profile/page.tsx`,
        content: `import {PhoneForm} from "@/components/auth/phone-form";
export default function ProfilePage(){return <main className="ng-shell"><h1>Your profile</h1><PhoneForm link/></main>;}
`,
      },
    );
  }
  return files;
}
