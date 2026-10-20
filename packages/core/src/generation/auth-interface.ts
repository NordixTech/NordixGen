import type { GeneratedFile } from "../plugins/contracts.js";
import type { FrontendAuthenticationContract } from "../plugins/frontend-contracts.js";
import { DEFAULT_PASSWORD_POLICY } from "../project/account-policy.js";

export function accountFormSource(config: FrontendAuthenticationContract, signup: boolean): string {
  const email = config.methods.includes("email-password");
  const phone = config.methods.includes("phone-number");
  const username = !signup && config.methods.includes("username-password");
  const policy = config.passwordPolicy ?? DEFAULT_PASSWORD_POLICY;
  const methods = [
    ...(email ? [{ id: "email", label: "Email" }] : []),
    ...(username ? [{ id: "username", label: "Username" }] : []),
    ...(phone ? [{ id: "phone", label: "Phone" }] : []),
  ];
  return `"use client";
import {useState,type FormEvent} from "react";
import {useRouter} from "next/navigation";
import {authClient} from "@/lib/auth/client";
import {useSessionView} from "@/lib/auth/use-session-view";
import {Input} from "@/components/ui/input";
import {Button} from "@/components/ui/button";
import {Notice} from "@/components/ui/notice";
${phone ? 'import {PhoneForm} from "./phone-form";' : ""}
${signup && email ? 'import {passwordSchema} from "@/lib/auth/password-policy";\nimport {PasswordRequirements} from "./password-requirements";' : ""}
const methods=${JSON.stringify(methods)};
export function ${signup ? "SignUpForm" : "SignInForm"}(){
 const router=useRouter();const {isPending:identityPending}=useSessionView();
 const [mode,setMode]=useState(methods[0].id),[pending,setPending]=useState(false),[error,setError]=useState(""),[message,setMessage]=useState("");
 ${signup && email ? 'const [password,setPassword]=useState("");' : ""}
 async function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();const data=new FormData(event.currentTarget);setError("");setMessage("");setPending(true);
 try{
 ${signup && email ? 'const parsed=passwordSchema.safeParse(password);if(!parsed.success){setError(parsed.error.issues.map(issue=>issue.message).join(" "));return;}' : ""}
 ${
   email
     ? `const result=${signup ? 'await authClient.signUp.email({name:String(data.get("name")??"").trim(),email:String(data.get("email")??""),password})' : username ? 'mode==="username"?await authClient.signIn.username({username:String(data.get("username")??""),password:String(data.get("password")??"")}):await authClient.signIn.email({email:String(data.get("email")??""),password:String(data.get("password")??"")})' : 'await authClient.signIn.email({email:String(data.get("email")??""),password:String(data.get("password")??"")})'};
 if(result.error){setError(result.error.message??"We could not ${signup ? "create your account" : "sign you in"}. Please try again.");return;}
 ${signup ? 'if(!result.data?.token){setMessage("Account created. Check your email to verify your account, then sign in.");return;}' : ""}
 await authClient.getSession();router.replace("/");router.refresh();`
     : ""
 }
 }catch{setError("We could not connect. Please check your connection and try again.");}finally{setPending(false);}}
 if(identityPending)return <section className="ng-panel ng-auth-card"><Notice>Checking session...</Notice></section>;
 return <section className="ng-panel ng-auth-card">
  <header className="ng-auth-heading"><span className="ng-auth-mark" aria-hidden="true">${signup ? "+" : "↗"}</span><h1>${signup ? "Create your account" : "Welcome back"}</h1><p>${signup ? "A few details and you are ready to get started." : "Choose how you would like to sign in."}</p></header>
  {methods.length>1&&<div role="tablist" aria-label="${signup ? "Registration" : "Sign-in"} method" className="ng-auth-tabs">{methods.map((method,index)=><button key={method.id} id={"auth-tab-"+method.id} role="tab" type="button" aria-selected={mode===method.id} aria-controls="auth-method-panel" tabIndex={mode===method.id?0:-1} onClick={()=>{setMode(method.id);setError("");setMessage("");}} onKeyDown={event=>{if(!["ArrowLeft","ArrowRight","Home","End"].includes(event.key))return;event.preventDefault();const next=event.key==="Home"?0:event.key==="End"?methods.length-1:(index+(event.key==="ArrowRight"?1:methods.length-1))%methods.length;setMode(methods[next].id);setError("");setMessage("");document.getElementById("auth-tab-"+methods[next].id)?.focus();}}>{method.label}</button>)}</div>}
  <div id="auth-method-panel" role={methods.length>1?"tabpanel":undefined} aria-labelledby={methods.length>1?"auth-tab-"+mode:undefined}>
   ${phone ? '{mode==="phone"?<PhoneForm/>:' : ""}${
     email
       ? `<form className="ng-auth-form" onSubmit={submit}>
    {error&&<Notice tone="alert">{error}</Notice>}{message&&<Notice>{message}</Notice>}
    ${signup ? '<Input id="name" name="name" label="Name" autoComplete="name" placeholder="Your full name" maxLength={100} required/>' : ""}
    ${username ? '{mode==="username"?<Input id="username" name="username" label="Username" autoComplete="username" placeholder="Your username" required/>:' : ""}<Input id="email" name="email" label="Email" type="email" autoComplete="email" placeholder="you@example.com" required/>${username ? "}" : ""}
    <Input id="password" name="password" label="${policy.numericOnly ? "PIN" : "Password"}${signup ? ` (at least ${policy.minLength} characters)` : ""}" type="password" autoComplete="${signup ? "new-password" : "current-password"}" ${policy.numericOnly ? 'inputMode="numeric" pattern="[0-9]+"' : ""} ${signup ? `minLength={${policy.minLength}} maxLength={${policy.maxLength}} value={password} onChange={event=>setPassword(event.target.value)} aria-describedby="password-requirements"` : ""} required/>
    ${signup ? "<PasswordRequirements value={password}/>" : '<a className="ng-text-link ng-auth-forgot" href="/forgot-password">Forgot your password?</a>'}
    <Button type="submit" disabled={pending}>${signup ? '{pending?"Creating account…":"Create account"}' : '{pending?"Signing in…":"Sign in"}'}</Button>
   </form>`
       : "null"
   }${phone ? "}" : ""}
  </div>
  ${config.identityProviders.length ? `<div className="ng-auth-social"><span>Or continue with</span><div>${config.identityProviders.map((provider) => `<Button type="button" variant="secondary" disabled={pending} onClick={async()=>{setPending(true);setError("");try{const result=await authClient.signIn.social({provider:${JSON.stringify(provider)},callbackURL:"/"});if(result.error)setError(result.error.message??"Could not connect to this provider.");}catch{setError("Could not connect to this provider. Please try again.");}finally{setPending(false);}}}>${provider[0].toUpperCase() + provider.slice(1)}</Button>`).join("")}</div></div>` : ""}
  <p className="ng-auth-footer">${signup ? 'Already registered? <a className="ng-text-link" href="/sign-in">Sign in</a>' : 'New here? <a className="ng-text-link" href="/sign-up">Create an account</a>'}</p>
 </section>;
}
`;
}

export function accountPageSource(signup: boolean): string {
  const component = signup ? "SignUpForm" : "SignInForm";
  return `import {${component}} from "@/components/auth/${signup ? "sign-up" : "sign-in"}-form";
export const metadata={title:${JSON.stringify(signup ? "Create account" : "Sign in")}};
export default function ${signup ? "SignUpPage" : "SignInPage"}(){return <main className="ng-shell ng-auth-page"><div className="ng-auth-wrap"><${component}/></div></main>;}
`;
}

export function authInterfaceFiles(root: string): GeneratedFile[] {
  return [
    {
      path: `${root}/components/auth/password-requirements.tsx`,
      content: `"use client";
import {passwordPolicy as policy} from "@/lib/auth/password-policy";
export function PasswordRequirements({value}:{value:string}){
 const rules=[{label:"At least "+policy.minLength+" characters",valid:value.length>=policy.minLength},...(policy.numericOnly?[{label:"Digits 0–9 only",valid:/^[0-9]+$/.test(value)}]:[{label:"One uppercase letter (A–Z)",valid:/[A-Z]/.test(value),enabled:policy.requireUppercase},{label:"One lowercase letter (a–z)",valid:/[a-z]/.test(value),enabled:policy.requireLowercase},{label:"One number (0–9)",valid:/[0-9]/.test(value),enabled:policy.requireNumber},{label:"One symbol, such as !, @ or #",valid:/[^A-Za-z0-9\\s]/.test(value),enabled:policy.requireSpecialChar}].filter(rule=>rule.enabled))];
 return <ul id="password-requirements" className="ng-password-rules" aria-label="Password requirements">{rules.map(rule=><li key={rule.label} data-met={value.length>0&&rule.valid}><span aria-hidden="true">{value.length>0&&rule.valid?"✓":"○"}</span>{rule.label}</li>)}</ul>;
}
`,
    },
  ];
}

export const authStyles = `
.ng-auth-page{display:grid;align-items:center;justify-items:center;padding:48px 24px 72px;min-height:calc(100dvh - 84px)}
.ng-auth-wrap{width:100%;max-width:480px;margin:auto}
.ng-auth-card{padding:32px;border:1px solid var(--color-border);border-radius:24px;min-width:0}
.ng-auth-heading{text-align:center;margin-bottom:28px}.ng-auth-heading h1{font-size:28px;line-height:1.2;letter-spacing:-.04em;margin:18px 0 10px;font-weight:650}.ng-auth-heading p,.ng-auth-description{color:var(--color-muted);font-size:14px;line-height:1.7;margin:0}
.ng-auth-mark{display:inline-grid;place-items:center;width:46px;height:46px;background:var(--color-primary-surface);color:var(--color-primary);border:1px solid var(--color-border);border-radius:14px;font-size:25px}
.ng-auth-form{display:grid;gap:20px}.ng-auth-form .ng-field{display:grid;gap:8px}.ng-auth-form .ng-label{font-size:13px;font-weight:600}.ng-auth-form .ng-input{min-height:46px;border-radius:10px;padding:11px 13px;background:var(--color-background)}.ng-auth-form .ng-input:focus{outline:2px solid var(--color-focus);outline-offset:2px}.ng-auth-form>.ng-button{width:100%;min-height:46px;margin-top:4px}.ng-auth-form .ng-notice{margin:0;line-height:1.6;font-size:13px}.ng-auth-forgot{justify-self:end;font-size:13px;margin-top:-6px}.ng-auth-footer{border-top:1px solid var(--color-border);padding-top:22px;margin:26px 0 0;text-align:center;font-size:13px;color:var(--color-muted);line-height:1.8}.ng-auth-footer a{margin-left:4px}
.ng-auth-tabs{display:flex;gap:4px;padding:4px;border:1px solid var(--color-border);border-radius:12px;background:var(--color-background);margin:0 0 26px}.ng-auth-tabs button{flex:1;border:0;border-radius:8px;padding:10px 8px;background:transparent;color:var(--color-muted);font:inherit;font-size:13px;cursor:pointer}.ng-auth-tabs button[aria-selected=true]{background:var(--color-primary-surface);color:var(--color-primary);font-weight:650;box-shadow:0 1px 4px var(--color-shadow)}.ng-auth-tabs button:focus-visible{outline:2px solid var(--color-focus);outline-offset:2px}
.ng-password-rules{display:grid;gap:6px;list-style:none;padding:0;margin:-6px 0 0;font-size:12px;color:var(--color-muted);line-height:1.5}.ng-password-rules li{display:flex;gap:8px}.ng-password-rules li[data-met=true]{color:var(--color-success,var(--color-primary))}.ng-auth-social{margin-top:24px;text-align:center}.ng-auth-social>span{font-size:12px;color:var(--color-muted)}.ng-auth-social>div{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}.ng-auth-social .ng-button{flex:1;min-width:100px}.ng-auth-inline-actions{display:flex;justify-content:center;gap:16px;flex-wrap:wrap;font-size:13px}.ng-auth-form h2{font-size:17px;margin:0}.ng-auth-code{letter-spacing:.3em;text-align:center;font-size:22px!important}
.ng-phone-fields{display:grid;grid-template-columns:120px minmax(0,1fr);gap:10px;align-items:end}.ng-country-picker{position:relative}.ng-country-picker>summary{display:flex;gap:8px;align-items:center;justify-content:center;cursor:pointer;list-style:none;min-height:46px;border:1px solid var(--color-border);border-radius:10px;background:var(--color-background);font-size:13px}.ng-country-picker>summary::-webkit-details-marker{display:none}.ng-country-picker svg{width:22px;height:16px;flex-shrink:0}.ng-country-popover{position:absolute;z-index:20;top:calc(100% + 8px);left:0;width:min(340px,calc(100vw - 96px));padding:10px;background:var(--color-surface);border:1px solid var(--color-border);border-radius:12px;box-shadow:0 12px 40px var(--color-shadow)}.ng-country-options{max-height:220px;overflow:auto;display:grid;margin-top:8px}.ng-country-options button{display:flex;align-items:center;gap:10px;width:100%;padding:10px;border:0;border-radius:6px;color:var(--color-foreground);background:transparent;font:inherit;text-align:left;font-size:13px;cursor:pointer}.ng-country-options button:hover,.ng-country-options button:focus-visible{background:var(--color-primary-surface);outline:2px solid var(--color-focus)}.ng-country-options small{margin-left:auto;color:var(--color-muted)}.ng-phone-help{grid-column:1/-1;font-size:12px;color:var(--color-muted);margin:0}.ng-phone-fields .ng-field-error{grid-column:1/-1;margin:0}.ng-phone-country-label{display:block;font-size:13px;font-weight:600;margin-bottom:8px}
.ng-profile-page{max-width:900px;margin:0 auto;padding-top:48px;padding-bottom:64px}.ng-profile-header{margin-bottom:28px}.ng-profile-header h1{font-size:30px;margin:8px 0}.ng-profile-header p{color:var(--color-muted);font-size:14px;line-height:1.7}.ng-profile-grid{display:grid;grid-template-columns:1fr 1.2fr;gap:24px;align-items:start}.ng-profile-summary{display:grid;gap:20px;padding:26px;border:1px solid var(--color-border);box-shadow:none}.ng-profile-avatar{display:grid;place-items:center;width:56px;height:56px;border-radius:18px;background:var(--color-primary-surface);color:var(--color-primary);font-size:24px;font-weight:650}.ng-profile-summary h2{font-size:20px;margin:0}.ng-profile-summary dl{display:grid;gap:20px;margin:0}.ng-profile-summary dt{font-size:12px;color:var(--color-muted);margin-bottom:6px}.ng-profile-summary dd{margin:0;font-size:14px;overflow-wrap:anywhere}.ng-profile-phone{padding:26px;border:1px solid var(--color-border);box-shadow:none}
@media(max-width:640px){.ng-auth-page{padding:28px 16px 48px}.ng-auth-card{padding:24px 20px;border-radius:18px}.ng-auth-heading h1{font-size:25px}.ng-profile-grid{grid-template-columns:1fr}.ng-profile-page{padding-top:28px}.ng-profile-phone,.ng-profile-summary{padding:22px}.ng-auth-wrap{max-width:460px}}
`;
