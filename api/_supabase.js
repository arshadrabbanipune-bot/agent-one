import {env,session,setSession} from './_auth.js';

// The publishable key identifies this Supabase project but grants no bypass of
// Auth, RLS, or database policies. It remains server-side here so the browser
// only talks to this application's auth endpoints.
const projectUrl='https://uzzdaqbowqdarnjynmuj.supabase.co';
const publishableKey='sb_publishable_kFvmBHwtPHEUA5c3l7Ct3g_I1mJH_vp';
export const supabaseUrl=()=>env('SUPABASE_URL')||projectUrl;
export const supabaseKey=()=>env('SUPABASE_PUBLISHABLE_KEY')||publishableKey;

export const supabaseAuth=async(path,{method='GET',body,token}={})=>{
  const response=await fetch(`${supabaseUrl()}${path}`,{
    method,
    headers:{apikey:supabaseKey(),authorization:`Bearer ${token||supabaseKey()}`,'content-type':'application/json'},
    body:body?JSON.stringify(body):undefined
  });
  const json=await response.json().catch(()=>({}));
  return {ok:response.ok,status:response.status,json};
};

export const authGrant=value=>value?.access_token?{
  accessToken:value.access_token,
  refreshToken:value.refresh_token||'',
  expiresAt:Date.now()+Math.max(30,Number(value.expires_in||3600))*1000
}:null;

// Data API calls run as the authenticated Supabase user so row-level security
// remains the authorization boundary. The publishable key never bypasses RLS.
export const ensureUserAccess=async(req,res)=>{
  let current=session(req);
  if(!current?.user)return {session:null,token:null};
  if(current.auth?.accessToken&&Number(current.auth.expiresAt||0)>Date.now()+60_000)return {session:current,token:current.auth.accessToken};
  if(!current.auth?.refreshToken)return {session:current,token:null};
  const refreshed=await supabaseAuth('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:{refresh_token:current.auth.refreshToken}});
  const auth=refreshed.ok?authGrant(refreshed.json):null;
  if(!auth)return {session:current,token:null};
  current={...current,auth};
  setSession(res,current.user,current.notion,auth);
  return {session:current,token:auth.accessToken};
};

export const supabaseData=async(path,{method='GET',body,token,prefer}={})=>{
  const headers={apikey:supabaseKey(),authorization:`Bearer ${token}`,'content-type':'application/json'};
  if(prefer)headers.prefer=prefer;
  const response=await fetch(`${supabaseUrl()}${path}`,{method,headers,body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15_000)});
  const text=await response.text();
  let json={};try{json=text?JSON.parse(text):{};}catch{json={message:text};}
  return {ok:response.ok,status:response.status,json};
};
