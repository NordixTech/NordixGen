/** No delivery adapter logs provider responses, credentials or secrets in production. */
export const authDeliverySource = String.raw`import {APIError} from "better-auth/api";
export interface DeliveryEnvironment {
 NODE_ENV?:string; RESEND_API_KEY?:string; AUTH_EMAIL_FROM?:string;
 SMTP_HOST?:string; SMTP_PORT?:string; SMTP_USER?:string; SMTP_PASSWORD?:string; SMTP_SECURE?:string;
 TWILIO_ACCOUNT_SID?:string; TWILIO_AUTH_TOKEN?:string; TWILIO_FROM_NUMBER?:string;
}
const unavailable=()=>new APIError("INTERNAL_SERVER_ERROR",{message:"El servicio de envío no está configurado temporalmente. Contacte al administrador"});
function production(env:DeliveryEnvironment){return (env.NODE_ENV??process.env.NODE_ENV??"production")==="production";}
export function assertEmailDelivery(env:DeliveryEnvironment):void {
 if(!production(env))return;
 const smtp=env.SMTP_HOST&&env.SMTP_USER&&env.SMTP_PASSWORD&&env.AUTH_EMAIL_FROM;
 const resend=env.RESEND_API_KEY&&env.AUTH_EMAIL_FROM;
 if(!smtp&&!resend)throw unavailable();
}
export async function sendAuthEmail(env:DeliveryEnvironment,to:string,subject:string,url:string):Promise<void>{
 assertEmailDelivery(env);
 try{
  if(env.SMTP_HOST){
   const {createTransport}=await import("nodemailer");
   const transport=createTransport({host:env.SMTP_HOST,port:Number(env.SMTP_PORT??"587"),secure:env.SMTP_SECURE==="true",requireTLS:production(env)&&env.SMTP_SECURE!=="true",...(env.SMTP_USER&&env.SMTP_PASSWORD?{auth:{user:env.SMTP_USER,pass:env.SMTP_PASSWORD}}:{}),connectionTimeout:10000,greetingTimeout:10000,socketTimeout:10000});
   try{await transport.sendMail({from:env.AUTH_EMAIL_FROM??"Nordix <auth@localhost>",to,subject,text:url});}finally{transport.close();}
  }else if(env.RESEND_API_KEY&&env.AUTH_EMAIL_FROM){
   const response=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:"Bearer "+env.RESEND_API_KEY,"Content-Type":"application/json"},body:JSON.stringify({from:env.AUTH_EMAIL_FROM,to,subject,text:url})});
   if(!response.ok)throw unavailable();
  }else console.log("[DEV AUTH] Email for "+to+": "+url);
 }catch{throw unavailable();}
}
export async function sendSmsOtp(env:DeliveryEnvironment,phoneNumber:string,code:string):Promise<void>{
 if(!env.TWILIO_ACCOUNT_SID||!env.TWILIO_AUTH_TOKEN||!env.TWILIO_FROM_NUMBER){
  if(production(env))throw unavailable();
  console.log("[DEV AUTH] SMS OTP for "+phoneNumber+": "+code+" (Expires in 10 minutes)");return;
 }
 try{
  const response=await fetch("https://api.twilio.com/2010-04-01/Accounts/"+encodeURIComponent(env.TWILIO_ACCOUNT_SID)+"/Messages.json",{method:"POST",headers:{Authorization:"Basic "+btoa(env.TWILIO_ACCOUNT_SID+":"+env.TWILIO_AUTH_TOKEN),"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({To:phoneNumber,From:env.TWILIO_FROM_NUMBER,Body:"Your verification code is "+code+". Expires in 10 minutes."}).toString()});
  if(!response.ok)throw unavailable();
 }catch{throw unavailable();}
}
`;
