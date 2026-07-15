import {setSession} from '../_auth.js';
import {authGrant,supabaseAuth} from '../_supabase.js';

const readBody=req=>{
  // Vercel's Node runtime may already have parsed JSON into req.body.
  // Reading the consumed stream again would otherwise leave this request pending.
  if(req.body&&typeof req.body==='object')return Promise.resolve(req.body);
  if(typeof req.body==='string'){
    try{return Promise.resolve(JSON.parse(req.body||'{}'));}
    catch{return Promise.reject(new Error('Invalid request.'));}
  }
  return new Promise((resolve,reject)=>{
    let body='';
    req.on('data',part=>{body+=part;if(body.length>10_000)reject(new Error('Request is too large.'));});
    req.on('end',()=>{try{resolve(JSON.parse(body||'{}'));}catch{reject(new Error('Invalid request.'));}});
    req.on('error',reject);
  });
};
const respond=(res,status,payload)=>{res.statusCode=status;res.setHeader('content-type','application/json; charset=utf-8');res.setHeader('cache-control','no-store');res.end(JSON.stringify(payload));};

export default async function handler(req,res){
  if(req.method!=='POST'){res.setHeader('allow','POST');return respond(res,405,{error:'Method not allowed.'});}
  try{
    const {email,password}=await readBody(req);
    const result=await supabaseAuth('/auth/v1/token?grant_type=password',{method:'POST',body:{email:String(email||'').trim().toLowerCase(),password:String(password||'')}});
    if(!result.ok||!result.json.user)return respond(res,401,{error:'Incorrect email or password.'});
    const user=result.json.user;
    setSession(res,{id:user.id,name:user.email,email:user.email},null,authGrant(result.json));
    return respond(res,200,{ok:true});
  }catch{return respond(res,502,{error:'Sign-in is temporarily unavailable. Please try again.'});}
}
