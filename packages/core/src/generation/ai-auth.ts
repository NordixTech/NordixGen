/** Better Auth owns token issuance, hashing, expiration and revocation. */
export const aiAuthSource = `import {apiKey} from "@better-auth/api-key";
import {oauthProvider,getOAuthProviderApi,type OAuthOptions} from "@better-auth/oauth-provider";
import {createAuthEndpoint} from "better-auth/api";
import {z} from "zod/v4";
import type {AuthEnvironment} from "../auth/auth.js";
export function oauthOptions(env:AuthEnvironment):OAuthOptions<string[]>{
 const origin=new URL(env.MCP_PUBLIC_URL!).origin;
 return {scopes:["mcp:tools","offline_access"],grantTypes:["authorization_code","refresh_token"],
  disableJwtPlugin:true,loginPage:origin+"/sign-in",consentPage:origin+"/consent",
  allowDynamicClientRegistration:true,allowUnauthenticatedClientRegistration:true,clientRegistrationDefaultApplicationType:"infer",
  resources:[{identifier:origin+"/mcp",name:"Application tools",allowedScopes:["mcp:tools"]}],
  clientRegistrationDefaultResources:[origin+"/mcp"],clientRegistrationDefaultScopes:["mcp:tools","offline_access"],clientRegistrationAllowedScopes:["mcp:tools","offline_access"],
 };
}
export function mcpApiKeys(){return apiKey({defaultPrefix:"nordix_live_sk_",enableSessionForAPIKeys:false,rateLimit:{enabled:true,timeWindow:60000,maxRequests:100}});}
export function mcpOAuth(env:AuthEnvironment){const options=oauthOptions(env);return oauthProvider(options);}
export function mcpVerifier(env:AuthEnvironment){return {id:"nordix-mcp-verifier",endpoints:{verifyMcpToken:createAuthEndpoint("/ai/verify-oauth",{
 method:"POST",body:z.object({token:z.string().min(1)}),metadata:{SERVER_ONLY:true},
},async ctx=>{
 const payload=await getOAuthProviderApi(ctx,oauthOptions(env)).requireActiveAccessToken(ctx.body.token);
 const audiences=typeof payload.aud==="string"?[payload.aud]:payload.aud??[];
 if(typeof payload.sub!=="string" || !audiences.includes(new URL(env.MCP_PUBLIC_URL!).origin+"/mcp") || typeof payload.scope!=="string" || !payload.scope.split(" ").includes("mcp:tools"))return null;
 return {userId:payload.sub};
})}};}
`;
