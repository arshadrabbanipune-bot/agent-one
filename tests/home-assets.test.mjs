import assert from 'node:assert/strict';
import home from '../api/home.js';

const response=()=>({statusCode:0,headers:{},body:'',setHeader(name,value){this.headers[name.toLowerCase()]=value;},end(value){this.body=value;}});
const html=response();home({url:'/'},html);
assert.equal(html.statusCode,200);assert.match(html.headers['content-type'],/text\/html/);assert.match(html.body,/id="assistantFab"/);
const client=response();home({url:'/api/home?asset=app'},client);
assert.equal(client.statusCode,200);assert.match(client.headers['content-type'],/javascript/);assert.match(client.body,/api\/assistant\?action=transcribe/);assert.match(client.body,/openDatabaseTables=new Set/);
console.log('single-source production client fixture passed');
