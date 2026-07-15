import assert from 'node:assert/strict';
import {createNotionClient,notionTitle} from '../api/_notion.js';

const originalFetch=globalThis.fetch;
assert.equal(notionTitle({title:{type:'title',title:[{plain_text:'Courses'}]}}),'Courses');
const calls=[];
let positionedCreated=false;
globalThis.fetch=async (url,options={})=>{
  calls.push({url:String(url),method:options.method||'GET',body:options.body?JSON.parse(options.body):null,headers:options.headers});
  if(String(url).includes('/data_sources/source-12345678/query'))return {ok:true,status:200,headers:new Headers(),json:async()=>({results:[],has_more:false})};
  if(String(url).includes('/blocks/page-12345678/children'))return {ok:true,status:200,headers:new Headers(),json:async()=>({results:[{id:'block-1',type:'paragraph',paragraph:{rich_text:[{plain_text:'Morning run'}]},has_children:false}],has_more:false})};
  if(String(url).includes('/blocks/page-87654321/children')&&(options.method||'GET')==='PATCH'){positionedCreated=true;return {ok:true,status:200,headers:new Headers(),json:async()=>({results:[{id:'created-block'}]})};}
  if(String(url).includes('/blocks/page-87654321/children'))return {ok:true,status:200,headers:new Headers(),json:async()=>({results:positionedCreated?[{id:'created-block',type:'paragraph',paragraph:{rich_text:[{plain_text:'Evening walk'}]},has_children:false}]:[],has_more:false})};
  if(String(url).includes('/blocks/archive-12345678')&&(options.method||'GET')==='PATCH')return {ok:true,status:200,headers:new Headers(),json:async()=>({id:'archive-12345678',in_trash:true})};
  throw new Error(`Unexpected request: ${url}`);
};

try{
  const client=createNotionClient('server-only-notion-token');
  await client.queryCollection({collectionId:'source-12345678',dateProperty:'Date',dateEquals:'2026-07-14',titleProperty:null,titleContains:null,sortProperty:'Date',sortDirection:'descending',pageSize:20});
  assert.deepEqual(calls[0].body,{page_size:20,filter:{property:'Date',date:{equals:'2026-07-14'}},sorts:[{property:'Date',direction:'descending'}]});
  assert.equal(calls[0].headers.authorization,'Bearer server-only-notion-token');
  const duplicate=await client.appendBlocks({parentBlockId:'page-12345678',afterBlockId:null,blocks:[{type:'paragraph',text:'Morning run',checked:null}],idempotencyKey:'same-command'});
  assert.equal(duplicate.status,'already_present');
  assert.equal(calls.filter(call=>call.method==='PATCH').length,0,'a matching existing block must never be duplicated');
  const positioned=await client.appendBlocks({parentBlockId:'page-87654321',afterBlockId:'after-12345678',blocks:[{type:'paragraph',text:'Evening walk',checked:null}],idempotencyKey:'positioned-command'});
  assert.equal(positioned.verified,true);
  const appendCall=calls.find(call=>call.url.includes('/blocks/page-87654321/children')&&call.method==='PATCH');
  assert.deepEqual(appendCall.body.position,{type:'after_block',after_block:{id:'after-12345678'}});
  assert.equal('after' in appendCall.body,false);
  const archived=await client.archiveObject({objectId:'archive-12345678',objectType:'block'});
  assert.equal(archived.verified,true);
  assert.deepEqual(calls.find(call=>call.url.includes('/blocks/archive-12345678')).body,{in_trash:true});
}finally{globalThis.fetch=originalFetch;}

console.log('Notion tool safety fixtures passed');
