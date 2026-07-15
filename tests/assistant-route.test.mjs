import assert from 'node:assert/strict';
import {createSession} from '../api/_auth.js';
import handler from '../api/assistant.js';

process.env.AUTH_SECRET='assistant-route-test-secret';
process.env.OPENAI_API_KEY='server-test-key';
const token=createSession({id:'assistant-user',email:'user@example.test'},{token:'notion-token',workspace:'Test'});
const originalFetch=globalThis.fetch;
globalThis.fetch=async url=>{
  if(String(url).includes('/v1/audio/transcriptions'))return {ok:false,status:429,text:async()=>JSON.stringify({error:{message:'rate limited'}})};
  throw new Error(`Unexpected request: ${url}`);
};
let status=0,body='';const res={headers:{},setHeader(name,value){this.headers[name]=value;},end(value){body=value;},flushHeaders(){}};
try{
  await handler({method:'POST',url:'/api/assistant?action=transcribe',headers:{cookie:`aos_session=${encodeURIComponent(token)}`},body:{mimeType:'audio/webm',durationMs:1000,audioBase64:Buffer.from('usable-audio-fixture').toString('base64')}},res);
}finally{globalThis.fetch=originalFetch;}
assert.equal(res.statusCode,429,'a recoverable OpenAI quota response must never escape as a Vercel 500');
assert.match(JSON.parse(body).error,/busy|rate.?limit/i);
console.log('assistant route error contract passed');
