import {setSession} from '../_auth.js';
import {authGrant,supabaseAuth} from '../_supabase.js';

const genders=new Set(['woman','man','non_binary','prefer_not_to_say','self_described']);
const readBody=req=>{
  // Vercel can pre-parse JSON before this function is invoked.
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
    const {email,password,age,gender}=await readBody(req);
    const normalizedEmail=String(email||'').trim().toLowerCase();
    const normalizedAge=Number(age);
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail))return respond(res,400,{error:'Enter a valid email address.'});
    if(String(password||'').length<8)return respond(res,400,{error:'Use a password with at least 8 characters.'});
    if(!Number.isInteger(normalizedAge)||normalizedAge<13||normalizedAge>120)return respond(res,400,{error:'Enter an age from 13 to 120.'});
    if(!genders.has(gender))return respond(res,400,{error:'Choose a gender option.'});
    const result=await supabaseAuth('/auth/v1/signup',{method:'POST',body:{email:normalizedEmail,password, data:{age:normalizedAge,gender}}});
    if(!result.ok)return respond(res,400,{error:'We could not create that account. Check the details and try again.'});
    if(result.json.access_token&&result.json.user)setSession(res,{id:result.json.user.id,name:normalizedEmail,email:normalizedEmail},null,authGrant(result.json));
    return respond(res,200,{ok:true,needsEmailConfirmation:!result.json.access_token});
  }catch{return respond(res,502,{error:'Account creation is temporarily unavailable. Please try again.'});}
}
