import crypto from 'node:crypto';
import {appUrl,configured,set,startOAuthState,sendError} from '../_auth.js';
import {supabaseAuth,supabaseUrl} from '../_supabase.js';

// Supabase owns the Google provider credentials. This app owns only an
// HttpOnly PKCE verifier and a signed CSRF state; neither reaches browser JS.
export default async function handler(req,res){
  if(!configured('AUTH_SECRET'))return sendError(res,'Sign-in needs AUTH_SECRET configured on the server.');
  const origin=appUrl(req);
  if(!origin)return sendError(res,'A secure application URL could not be determined.');
  // Avoid sending a user to Supabase's generic provider error page when the
  // project owner has not enabled Google yet. This check uses the public Auth
  // settings endpoint and reveals no credentials.
  try{
    const settings=await supabaseAuth('/auth/v1/settings');
    if(settings.ok&&settings.json?.external?.google!==true){res.writeHead(303,{Location:'/?auth_error=google_not_configured'});return res.end();}
  }catch{}
  const verifier=crypto.randomBytes(48).toString('base64url');
  const challenge=crypto.createHash('sha256').update(verifier).digest('base64url');
  set(res,'aos_google_pkce',verifier,600);
  const state=startOAuthState(res,'google');
  const callback=new URL(`${origin}/api/auth/google/callback`);
  callback.searchParams.set('oauth_state',state);
  const url=new URL(`${supabaseUrl()}/auth/v1/authorize`);
  url.searchParams.set('provider','google');
  url.searchParams.set('redirect_to',callback.toString());
  url.searchParams.set('code_challenge',challenge);
  url.searchParams.set('code_challenge_method','s256');
  // Supabase Auth routes this browser navigation to its configured Google
  // provider. Google credentials remain inside Supabase and never appear here.
  res.writeHead(302,{Location:url.toString()});
  res.end();
}
