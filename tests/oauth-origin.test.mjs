import assert from 'node:assert/strict';
import {appUrl,cookies,sign} from '../api/_auth.js';
import notionStart from '../api/auth/notion.js';

process.env.AUTH_SECRET='oauth-origin-test-secret';
process.env.NOTION_CLIENT_ID='notion-client-id';
process.env.NOTION_CLIENT_SECRET='notion-client-secret';

const response=()=>({headers:new Map(),statusCode:200,ended:false,getHeader(name){return this.headers.get(name);},setHeader(name,value){this.headers.set(name,value);},writeHead(status,headers={}){this.statusCode=status;for(const [name,value] of Object.entries(headers))this.headers.set(name,value);},end(body=''){this.ended=true;this.body=body;}});

process.env.APP_URL='not a URL';
assert.equal(appUrl({headers:{host:'untrusted.example'}}),'');
assert.deepEqual(cookies({headers:{cookie:'safe=one; broken=%E0%A4%A'}}),{safe:'one',broken:''});

const activeSession=sign({user:{id:'student-1',email:'student@example.com'},notion:null,exp:Date.now()+60_000});
const missingOriginResponse=response();
notionStart({headers:{cookie:`aos_session=${encodeURIComponent(activeSession)}`,host:'preview.example'}},missingOriginResponse);
assert.equal(missingOriginResponse.statusCode,500);
assert.match(missingOriginResponse.body,/valid APP_URL/);

process.env.APP_URL='https://arshad-os-oauth-arshad8.vercel.app/some-path';
const configuredResponse=response();
notionStart({headers:{cookie:`aos_session=${encodeURIComponent(activeSession)}`,host:'preview.example'}},configuredResponse);
assert.equal(configuredResponse.statusCode,302);
const redirect=new URL(configuredResponse.headers.get('Location'));
assert.equal(redirect.searchParams.get('redirect_uri'),'https://arshad-os-oauth-arshad8.vercel.app/api/auth/notion/callback');

console.log('OAuth origin safety fixtures passed');
