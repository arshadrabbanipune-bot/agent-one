import {appUrl,clear,configured,consumeOAuthState,cookies,setSession,sendError} from '../../_auth.js';
import {authGrant,supabaseAuth} from '../../_supabase.js';

export default async function handler(req,res){
  if(!configured('AUTH_SECRET'))return sendError(res,'Sign-in needs AUTH_SECRET configured on the server.');
  const origin=appUrl(req);
  if(!origin)return sendError(res,'Sign-in needs a valid APP_URL configured on the server.');
  const incoming=new URL(req.url,origin);
  const verifier=cookies(req).aos_google_pkce;
  clear(res,'aos_google_pkce');
  if(!verifier||!consumeOAuthState(req,res,'google',incoming.searchParams.get('oauth_state'))||!incoming.searchParams.get('code'))return sendError(res,'Google sign-in could not be verified. Please restart sign-in.',400);
  try{
    const exchange=await supabaseAuth('/auth/v1/token?grant_type=pkce',{method:'POST',body:{auth_code:incoming.searchParams.get('code'),code_verifier:verifier}});
    if(!exchange.ok||!exchange.json?.access_token)return sendError(res,'Google sign-in was rejected by Supabase. Please try again.',400);
    const profile=await supabaseAuth('/auth/v1/user',{token:exchange.json.access_token});
    if(!profile.ok||!profile.json?.id||!profile.json?.email)return sendError(res,'Google did not return a usable account. Please try again.',400);
    const metadata=profile.json.user_metadata||{};
    setSession(res,{id:profile.json.id,email:profile.json.email,name:metadata.full_name||metadata.name||profile.json.email},null,authGrant(exchange.json));
    res.writeHead(303,{Location:'/?signed_in=1'});res.end();
  }catch{return sendError(res,'Google sign-in is temporarily unavailable. Please try again.',502);}
}
