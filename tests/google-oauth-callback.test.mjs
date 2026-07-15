import assert from 'node:assert/strict';
import googleCallback from '../api/auth/google/callback.js';
import {startOAuthState} from '../api/_auth.js';

process.env.AUTH_SECRET='oauth-callback-test-secret';
process.env.APP_URL='https://arshad-os-oauth-arshad8.vercel.app';

const stateHeaders=new Map();
const stateResponse={
  getHeader(name){return stateHeaders.get(name);},
  setHeader(name,value){stateHeaders.set(name,value);}
};
const oauthState=startOAuthState(stateResponse,'google');
const stateCookie=String(stateHeaders.get('Set-Cookie')).split(';')[0];
const verifierCookie='aos_google_pkce=test-pkce-verifier';
const calls=[];
const originalFetch=globalThis.fetch;
globalThis.fetch=async(url,options)=>{
  calls.push([String(url),options]);
  if(String(url).includes('/auth/v1/token?grant_type=pkce'))return new Response(JSON.stringify({access_token:'test-access-token'}),{status:200,headers:{'content-type':'application/json'}});
  if(String(url).endsWith('/auth/v1/user'))return new Response(JSON.stringify({id:'google-user-1',email:'student@example.com',user_metadata:{full_name:'Student One'}}),{status:200,headers:{'content-type':'application/json'}});
  return new Response('{}',{status:404});
};

let status=0;let location='';
const headers=new Map();
const response={
  getHeader(name){return headers.get(name);},
  setHeader(name,value){headers.set(name,value);},
  writeHead(code,values){status=code;location=values.Location||'';},
  end(){}
};

await googleCallback({
  url:`/api/auth/google/callback?code=provider-code&oauth_state=${encodeURIComponent(oauthState)}`,
  headers:{host:'arshad-os-oauth-arshad8.vercel.app',cookie:`${stateCookie}; ${verifierCookie}`}
},response);
globalThis.fetch=originalFetch;

assert.equal(status,303);
assert.equal(location,'/?signed_in=1');
assert.equal(calls.length,2);
assert.match(calls[0][0],/grant_type=pkce/);
assert.deepEqual(JSON.parse(calls[0][1].body),{auth_code:'provider-code',code_verifier:'test-pkce-verifier'});
assert.equal(calls[1][1].headers.authorization,'Bearer test-access-token');
assert.match(String(headers.get('Set-Cookie')),/aos_session=/);
console.log('Supabase Google OAuth callback fixture passed');
