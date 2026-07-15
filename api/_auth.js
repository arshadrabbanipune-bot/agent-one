import crypto from 'node:crypto';
const b64=v=>Buffer.from(v).toString('base64url');const unb64=v=>Buffer.from(v,'base64url');
const firstNonEmptyLine=value=>String(value||'').split(/\r?\n/).map(line=>line.trim()).find(Boolean)||'';
export const env=key=>{
  const raw=process.env[key]||'';
  // OAuth credentials are single-line values. Vercel's dashboard can preserve
  // accidental pasted line breaks, which otherwise produces an invalid client_id.
  if(/CLIENT_(ID|SECRET)$/.test(key))return firstNonEmptyLine(raw);
  return String(raw).trim();
};
const safeOrigin=value=>{
  try{
    const parsed=new URL(String(value||''));
    if(!/^https?:$/.test(parsed.protocol)||parsed.username||parsed.password)return '';
    return parsed.origin;
  }catch{return ''}
};
// OAuth providers require one exact, registered callback URL. Never derive an
// OAuth callback from a request host: preview aliases, malformed Host headers,
// and alternate Vercel domains are not necessarily registered with Google or
// Notion and lead to provider-side "invalid redirect URI" pages.
export const appUrl=()=>safeOrigin(env('APP_URL'))||'';
export const configured=(...keys)=>keys.every(key=>Boolean(env(key)));
const decodeCookie=value=>{try{return decodeURIComponent(value);}catch{return '';}};
export const cookies=req=>Object.fromEntries((req.headers.cookie||'').split(';').filter(Boolean).map(p=>{const i=p.indexOf('=');return i>0?[p.slice(0,i).trim(),decodeCookie(p.slice(i+1))]:null;}).filter(Boolean));
const key=()=>env('AUTH_SECRET');
export const sign=value=>{if(!key())throw new Error('AUTH_SECRET is missing');const body=b64(JSON.stringify(value));return `${body}.${crypto.createHmac('sha256',key()).update(body).digest('base64url')}`};
export const verify=token=>{try{const [body,signature]=String(token||'').split('.');const expected=crypto.createHmac('sha256',key()).update(body).digest('base64url');if(!body||!signature||!crypto.timingSafeEqual(Buffer.from(signature),Buffer.from(expected)))return null;const payload=JSON.parse(unb64(body));return payload.exp>Date.now()?payload:null}catch{return null}};
// The session cookie is HttpOnly, but it is still delivered to the browser.
// Keep third-party access grants unreadable there: only the server that has
// AUTH_SECRET can decrypt a Notion token. HMAC signing alone prevents edits
// but does not conceal the raw token from a compromised cookie store.
const cipherKey=()=>crypto.createHash('sha256').update(key()).digest();
const seal=value=>{try{const iv=crypto.randomBytes(12);const cipher=crypto.createCipheriv('aes-256-gcm',cipherKey(),iv);const encrypted=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);return ['v1',iv.toString('base64url'),cipher.getAuthTag().toString('base64url'),encrypted.toString('base64url')].join('.')}catch{return null}};
const unseal=value=>{try{const [version,iv,tag,encrypted]=String(value||'').split('.');if(version!=='v1'||!iv||!tag||!encrypted)return null;const decipher=crypto.createDecipheriv('aes-256-gcm',cipherKey(),Buffer.from(iv,'base64url'));decipher.setAuthTag(Buffer.from(tag,'base64url'));return JSON.parse(Buffer.concat([decipher.update(Buffer.from(encrypted,'base64url')),decipher.final()]).toString('utf8'))}catch{return null}};
const appendCookie=(res,value)=>{const previous=res.getHeader('Set-Cookie');res.setHeader('Set-Cookie',previous?[...(Array.isArray(previous)?previous:[previous]),value]:value)};
export const set=(res,name,value,maxAge=60*60*24*14)=>appendCookie(res,`${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`);
export const clear=(res,name)=>appendCookie(res,`${name}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`);
export const createSession=(user,notion,auth)=>sign({user,notion:notion?seal(notion):null,auth:auth?seal(auth):undefined,exp:Date.now()+1000*60*60*24*14});
export const session=req=>{const value=verify(cookies(req).aos_session);if(!value)return null;const next={...value,notion:typeof value.notion==='string'?unseal(value.notion):value.notion||null};if(value.auth!==undefined)next.auth=typeof value.auth==='string'?unseal(value.auth):null;return next};
export const setSession=(res,user,notion,auth)=>set(res,'aos_session',createSession(user,notion,auth));
export const state=(provider)=>sign({provider,nonce:crypto.randomBytes(18).toString('hex'),exp:Date.now()+1000*60*10});
export const startOAuthState=(res,provider)=>{const value=state(provider);set(res,'aos_oauth_state',value,600);return value};
export const consumeOAuthState=(req,res,provider,submitted)=>{const stored=cookies(req).aos_oauth_state;clear(res,'aos_oauth_state');if(!stored||!submitted||stored.length!==submitted.length)return null;if(!crypto.timingSafeEqual(Buffer.from(stored),Buffer.from(submitted)))return null;const payload=verify(submitted);return payload?.provider===provider?payload:null};
export const sendError=(res,message,status=500)=>{res.writeHead(status,{'content-type':'text/html; charset=utf-8'});res.end(`<main style="font-family:system-ui;padding:48px;background:#070b16;color:#eef5ff;min-height:100vh"><h1>Connection needs configuration</h1><p>${message}</p><p>Return to Agent One after adding the required Vercel environment variables.</p></main>`)};
