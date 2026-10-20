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
    files.push({
      path: `${root}/lib/auth/reset-link.ts`,
      content: `import {backendFetch} from "@/lib/backend/transport";
/** Use Better Auth's own callback to check existence and expiry without consuming the token. */
export async function checkResetLink(token:string,origin:string):Promise<"valid"|"invalid"|"unavailable">{
 try{const response=await backendFetch(${JSON.stringify(identity.backend)},"/api/auth/reset-password/"+encodeURIComponent(token)+"?callbackURL="+encodeURIComponent(origin+"/reset-password"),{cache:"no-store",redirect:"manual",signal:AbortSignal.timeout(5000)},origin);
 if(response.status>=500||response.status===429)return "unavailable";
 const location=response.headers.get("location");if(!location||response.status<300||response.status>=400)return "invalid";
 const destination=new URL(location,origin);
 return destination.origin===origin&&destination.pathname==="/reset-password"&&destination.searchParams.get("token")===token&&!destination.searchParams.has("error")?"valid":"invalid";
 }catch{return "unavailable";}
}
`,
    });
    files.push(
      {
        path: `${root}/components/auth/forgot-password-form.tsx`,
        content: `${imports}
export function ForgotPasswordForm({invalidLink=false}:{invalidLink?:boolean}){
 const {isPending:identityPending}=useSessionView();const [pending,setPending]=useState(false),[message,setMessage]=useState(""),[error,setError]=useState("");
 async function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();const form=new FormData(event.currentTarget);setPending(true);setMessage("");setError("");
 try{const result=await authClient.requestPasswordReset({email:String(form.get("email")),redirectTo:window.location.origin+"/reset-password"});if(result.error)setError(result.error.message??"We could not send the link. Please try again.");else setMessage("If an account exists, check your email for a password reset link.");}catch{setError("We could not connect. Please try again.");}finally{setPending(false);}}
 if(identityPending)return <Notice>Checking session...</Notice>;
 return <section className="ng-panel ng-auth-card"><header className="ng-auth-heading"><span className="ng-auth-mark" aria-hidden="true">↺</span><h1>Recover your account</h1><p>Enter your email and we will send you a link to choose a new password.</p></header><form className="ng-auth-form" onSubmit={submit}>
 {invalidLink&&!message&&<Notice tone="alert">This reset link is invalid, expired or already used. Request a new link below.</Notice>}{error&&<Notice tone="alert">{error}</Notice>}{message&&<Notice>{message}</Notice>}
 <Input id="email" name="email" label="Email" type="email" autoComplete="email" placeholder="you@example.com" required/><Button type="submit" disabled={pending}>{pending?"Sending link…":"Send reset link"}</Button></form><p className="ng-auth-footer"><a className="ng-text-link" href="/sign-in">Back to sign in</a></p></section>;
}
`,
      },
      {
        path: `${root}/app/forgot-password/page.tsx`,
        content: `import {ForgotPasswordForm} from "@/components/auth/forgot-password-form";
export const metadata={title:"Recover your account"};
export default async function ForgotPasswordPage({searchParams}:{searchParams:Promise<{error?:string}>}){const query=await searchParams;return <main className="ng-shell ng-auth-page"><div className="ng-auth-wrap"><ForgotPasswordForm invalidLink={query.error==="INVALID_TOKEN"}/></div></main>;}
`,
      },
      {
        path: `${root}/components/auth/reset-password-form.tsx`,
        content: `${imports}
import {passwordSchema,passwordPolicy} from "@/lib/auth/password-policy";
import {PasswordRequirements} from "./password-requirements";
export function ResetPasswordForm({token}:{token:string}){
 const {isPending:identityPending}=useSessionView();const [pending,setPending]=useState(false),[error,setError]=useState(""),[password,setPassword]=useState(""),[invalid,setInvalid]=useState(false);
 async function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();const form=new FormData(event.currentTarget),parsed=passwordSchema.safeParse(password);setError("");
 if(!parsed.success){setError(parsed.error.issues.map(issue=>issue.message).join(" "));return;}if(password!==form.get("confirmPassword")){setError("The passwords do not match. Enter the same password in both fields.");return;}
 setPending(true);try{const result=await authClient.resetPassword({token,newPassword:password});if(result.error){if(result.error.code==="INVALID_TOKEN"){setInvalid(true);setError("This reset link is invalid, expired or already used. Request a new link.");}else setError(result.error.message??"We could not reset your password. Please try again.");}else window.location.assign("/sign-in");}catch{setError("We could not connect. Please try again.");}finally{setPending(false);}}
 if(identityPending)return <Notice>Checking session...</Notice>;
 return <section className="ng-panel ng-auth-card"><header className="ng-auth-heading"><span className="ng-auth-mark" aria-hidden="true">↺</span><h1>Set your ${identity.passwordPolicy?.numericOnly ? "PIN" : "password"}</h1><p>Choose a new ${identity.passwordPolicy?.numericOnly ? "PIN" : "password"} to get back into your account.</p></header><form className="ng-auth-form" onSubmit={submit}>{error&&<Notice tone="alert">{error}</Notice>}{!invalid&&<><Input id="password" name="password" label={passwordPolicy.numericOnly?"New PIN":"New password"} type="password" inputMode={passwordPolicy.numericOnly?"numeric":undefined} autoComplete="new-password" minLength={passwordPolicy.minLength} maxLength={passwordPolicy.maxLength} value={password} onChange={event=>setPassword(event.target.value)} aria-describedby="password-requirements" required/><PasswordRequirements value={password}/><Input id="confirmPassword" name="confirmPassword" label="Confirm password / PIN" type="password" inputMode={passwordPolicy.numericOnly?"numeric":undefined} autoComplete="new-password" required/><Button type="submit" disabled={pending}>{pending?"Saving…":"Save password"}</Button></>}</form><p className="ng-auth-footer"><a className="ng-text-link" href={invalid?"/forgot-password":"/sign-in"}>{invalid?"Request a new reset link":"Back to sign in"}</a></p></section>;
}
`,
      },
      {
        path: `${root}/app/reset-password/page.tsx`,
        content: `import {headers} from "next/headers";
import {redirect} from "next/navigation";
import {checkResetLink} from "@/lib/auth/reset-link";
import {ResetPasswordForm} from "@/components/auth/reset-password-form";
import {Notice} from "@/components/ui/notice";
export const dynamic="force-dynamic";
export const metadata={title:"Set your password",referrer:"no-referrer"};
export default async function ResetPasswordPage({searchParams}:{searchParams:Promise<{token?:string;error?:string}>}){
 const query=await searchParams;const token=query.token;
 if(query.error||typeof token!=="string"||!token||token.length>256)redirect("/forgot-password?error=INVALID_TOKEN");
 const incoming=await headers();const protocol=process.env.NORDIX_LOCAL_RUNTIME==="1"||process.env.NODE_ENV==="development"?"http":"https";const origin=protocol+"://"+incoming.get("host");
 const state=await checkResetLink(token,origin);
 const unavailable=state==="unavailable",valid=state==="valid";
 if(unavailable)return <main className="ng-shell ng-auth-page"><div className="ng-auth-wrap ng-panel ng-auth-card"><Notice tone="alert">We could not check this reset link right now. Please wait a moment and try again.</Notice><p className="ng-auth-footer"><a className="ng-text-link" href="/forgot-password">Request a new reset link</a></p></div></main>;
 if(!valid)redirect("/forgot-password?error=INVALID_TOKEN");
 return <main className="ng-shell ng-auth-page"><div className="ng-auth-wrap"><ResetPasswordForm token={token}/></div></main>;
}
`,
      },
    );
  }
  if (identity.methods.includes("phone-number")) {
    const company = Boolean(identity.allowedEmailDomains?.length);
    files.push(
      {
        path: `${root}/components/auth/phone-field.tsx`,
        content: `"use client";
import {useRef,useState} from "react";
import PhoneInput from "react-phone-number-input/input";
import flags from "react-phone-number-input/flags";
import {getCountries,getCountryCallingCode,isValidPhoneNumber,parsePhoneNumber,type CountryCode,type E164Number} from "libphonenumber-js/max";
const labels=new Intl.DisplayNames(["en"],{type:"region"});const spanish=new Intl.DisplayNames(["es"],{type:"region"});
const normalize=(value:string)=>value.normalize("NFD").replace(/[\\u0300-\\u036f]/g,"").toLowerCase();
const countries=getCountries().sort((a,b)=>(labels.of(a)??a).localeCompare(labels.of(b)??b));
function Flag({country}:{country:CountryCode}){const Component=flags[country];return Component?<Component title={labels.of(country)??country}/>:null;}
export function PhoneField({value,onChange,disabled=false,error}:{value:string;onChange:(value:string,valid:boolean)=>void;disabled?:boolean;error?:string}){
 const [country,setCountry]=useState<CountryCode>("US"),[search,setSearch]=useState("");const picker=useRef<HTMLDetailsElement>(null);
 const matches=countries.filter(code=>normalize((labels.of(code)??code)+" "+(spanish.of(code)??"")+" "+code+" +"+getCountryCallingCode(code)).includes(normalize(search.trim())));
 return <div className="ng-phone-fields"><div><label className="ng-phone-country-label" htmlFor="phone-country">Country</label><details ref={picker} className="ng-country-picker" onKeyDown={event=>{if(event.key==="Escape"&&picker.current){picker.current.open=false;picker.current.querySelector("summary")?.focus();}}}><summary id="phone-country" aria-label="Country and calling code" onClick={event=>{if(disabled)event.preventDefault();}} aria-disabled={disabled}><Flag country={country}/><span>+{getCountryCallingCode(country)}</span><span aria-hidden="true">⌄</span></summary><div className="ng-country-popover"><input className="ng-input" aria-label="Search country or calling code" placeholder="Search country or +51" type="search" value={search} onChange={event=>setSearch(event.target.value)}/><div className="ng-country-options" aria-label="Countries">{matches.map(code=><button key={code} type="button" aria-pressed={code===country} onClick={()=>{setCountry(code);setSearch("");onChange("",false);if(picker.current){picker.current.open=false;picker.current.querySelector("summary")?.focus();}}}><Flag country={code}/><span>{labels.of(code)}</span><small>+{getCountryCallingCode(code)}</small></button>)}{matches.length===0&&<p className="ng-auth-description">No countries found.</p>}</div></div></details></div><div className="ng-field"><label className="ng-label" htmlFor="phone">Phone number</label><PhoneInput key={country} id="phone" className="ng-input" country={country} international={false} value={(value||undefined) as E164Number|undefined} onChange={next=>{const number=next??"";onChange(number,Boolean(number&&isValidPhoneNumber(number)&&parsePhoneNumber(number)?.country===country));}} autoComplete="tel-national" placeholder="Your phone number" disabled={disabled} aria-invalid={Boolean(error)} aria-describedby="phone-help" required/></div><p className="ng-phone-help" id="phone-help">{labels.of(country)} (+{getCountryCallingCode(country)}). Enter your number without the country code.</p>{error&&<p className="ng-field-error" role="alert">{error}</p>}</div>;
}
`,
      },
      {
        path: `${root}/components/auth/phone-form.tsx`,
        content: `${imports}
import {useRouter} from "next/navigation";
import {PhoneField} from "./phone-field";
import {useEffect} from "react";
export function PhoneForm({link=false}:{link?:boolean}){
 const {isPending:identityPending}=useSessionView();const router=useRouter();const [phone,setPhone]=useState(""),[phoneValid,setPhoneValid]=useState(false),[name,setName]=useState(""),[sent,setSent]=useState(false),[pending,setPending]=useState(false),[message,setMessage]=useState(""),[error,setError]=useState(""),[phoneError,setPhoneError]=useState("");
 const [waitUntil,setWaitUntil]=useState(0),[now,setNow]=useState(Date.now());const remaining=Math.max(0,Math.ceil((waitUntil-now)/1000));
 useEffect(()=>{if(waitUntil<=Date.now())return;const timer=setInterval(()=>{const current=Date.now();setNow(current);if(current>=waitUntil)clearInterval(timer);},1000);return ()=>clearInterval(timer);},[waitUntil]);
 function rememberWait(response:Response){const seconds=Number(response.headers.get("X-SMS-Retry-After")??response.headers.get("X-Retry-After")??response.headers.get("Retry-After"));if(Number.isFinite(seconds)&&seconds>0){const current=Date.now();setNow(current);setWaitUntil(current+seconds*1000);}}
 async function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();const form=new FormData(event.currentTarget);setError("");setMessage("");setPhoneError("");
 ${company ? "" : 'if(!link&&!name.trim()){setError("Enter your name before requesting a code.");return;}'}
 if(!phoneValid){setPhoneError("Enter a valid phone number for the selected country.");return;}
 setPending(true);try{if(!sent){const result=await authClient.phoneNumber.sendOtp({phoneNumber:phone,fetchOptions:{onResponse:context=>{rememberWait(context.response);}}});if(result.error){setError(result.error.message??"We could not send your code. Please try again.");return;}setSent(true);setMessage("Enter the 6-digit code sent to your phone.");}
 else{const result=await authClient.phoneNumber.verify({phoneNumber:phone,code:String(form.get("code")),updatePhoneNumber:link,disableSession:link${company ? "" : ",...(!link?{name:name.trim()}:{})"}});if(result.error){setError(result.error.message??"That code is incorrect or expired. Request another code and try again.");return;}
 await authClient.getSession();if(link){setSent(false);setMessage("Phone number linked. You can use it to sign in.");}else router.replace("/");router.refresh();}}
 catch{setError("We could not connect. Please try again.");}finally{setPending(false);}}
 if(identityPending)return <Notice>Checking session...</Notice>;
 return <form className="ng-auth-form" onSubmit={submit}><h2>{link?"Link your phone":"Continue with phone"}</h2><p className="ng-auth-description">${company ? "Use a phone already linked to your verified account. To link a new number, sign in with your company email first." : "We will send a one-time code to verify your number. No password needed."}</p>{error&&<Notice tone="alert">{error}</Notice>}{message&&<Notice>{message}</Notice>}
 ${company ? "" : '{!link&&<Input id="phone-name" name="name" label="Your name" autoComplete="name" placeholder="Your full name" value={name} onChange={event=>setName(event.target.value)} minLength={1} maxLength={100} required disabled={pending||sent}/>}'}
 <PhoneField value={phone} onChange={(value,valid)=>{setPhone(value);setPhoneValid(valid);setSent(false);setPhoneError("");setError("");}} disabled={pending||sent} error={phoneError}/>
 {sent&&<Input id="code" name="code" label="Verification code" className="ng-auth-code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" minLength={6} maxLength={6} placeholder="000000" required/>}<Button type="submit" disabled={pending||(!sent&&remaining>0)}>{pending?"Please wait…":sent?"Verify code":remaining>0?"Send code in "+remaining+"s":"Send code"}</Button>{sent&&<div className="ng-auth-inline-actions"><Button type="button" variant="secondary" disabled={pending||remaining>0} onClick={()=>{setSent(false);setMessage("");setError("");}}>{remaining>0?"Request another code in "+remaining+"s":"Change number / send another code"}</Button></div>}</form>;
}
`,
      },
      {
        path: `${root}/components/auth/profile-card.tsx`,
        content: `"use client";
import {authClient} from "@/lib/auth/client";
import {PhoneForm} from "./phone-form";
export function ProfileCard(){const {data}=authClient.useSession();const user=data?.user;return <div className="ng-profile-grid"><section className="ng-panel ng-profile-summary"><span className="ng-profile-avatar" aria-hidden="true">{user?.name?.trim().slice(0,1).toUpperCase()||"U"}</span><h2>{user?.name||"Your account"}</h2><dl><div><dt>Email</dt><dd>{user?.email?.endsWith("@phone.invalid")?"Phone account":user?.email||"—"}</dd></div><div><dt>Email verification</dt><dd>{user?.emailVerified?"Verified":"Not verified"}</dd></div><div><dt>Phone number</dt><dd>{user?.phoneNumber||"No phone linked yet"}</dd></div></dl></section><section className="ng-panel ng-profile-phone"><PhoneForm link/></section></div>;}
`,
      },
      {
        path: `${root}/app/profile/page.tsx`,
        content: `import {ProfileCard} from "@/components/auth/profile-card";
export default function ProfilePage(){return <main className="ng-shell"><div className="ng-profile-page"><header className="ng-profile-header"><p className="ng-eyebrow">Account settings</p><h1>Your profile</h1><p>Review your account details and manage your phone number.</p></header><ProfileCard/></div></main>;}
`,
      },
    );
  }
  return files;
}
