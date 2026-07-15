import assert from 'node:assert/strict';
import {createSession} from '../api/_auth.js';
import handler from '../api/notion/map.js';

process.env.AUTH_SECRET='current-map-route-test-secret';
const ok=value=>({ok:true,status:200,headers:new Headers(),json:async()=>value});
const title=value=>({Name:{type:'title',title:[{plain_text:value}]}});
const root={object:'page',id:'root-current',parent:{type:'workspace',workspace:true},properties:title('Student OS'),url:'https://notion.so/root-current'};
const source1={object:'data_source',id:'source-current-1',parent:{type:'database_id',database_id:'db-current'},database_parent:{type:'page_id',page_id:'root-current'},title:[{plain_text:'Courses'}],properties:{Name:{type:'title'},Status:{type:'status'}}};
const source2={object:'data_source',id:'source-current-2',parent:{type:'database_id',database_id:'db-current'},database_parent:{type:'page_id',page_id:'root-current'},title:[{plain_text:'Assignments'}],properties:{Name:{type:'title'},Due:{type:'date'}}};
const database={object:'database',id:'db-current',parent:{type:'page_id',page_id:'root-current'},title:[{plain_text:'Notion for students'}],data_sources:[{id:source1.id,name:'Courses'},{id:source2.id,name:'Assignments'}],url:'https://notion.so/db-current'};
const row1={object:'page',id:'row-current-1',parent:{type:'data_source_id',data_source_id:source1.id},properties:title('Physics')};
const row2={object:'page',id:'row-current-2',parent:{type:'data_source_id',data_source_id:source2.id},properties:title('Lab report')};
const originalFetch=globalThis.fetch;
globalThis.fetch=async(url,options={})=>{
  const path=new URL(url).pathname;
  if(path==='/v1/search')return ok({results:[root,source1],has_more:false,request_status:{incomplete_reason:null}});
  if(path==='/v1/data_sources/source-current-1')return ok(source1);
  if(path==='/v1/data_sources/source-current-2')return ok(source2);
  if(path==='/v1/databases/db-current')return ok(database);
  if(path==='/v1/data_sources/source-current-1/query')return ok({results:[row1],has_more:false});
  if(path==='/v1/data_sources/source-current-2/query')return ok({results:[row2],has_more:false});
  if(path==='/v1/blocks/root-current/children')return ok({results:[{id:'db-current',type:'child_database',child_database:{title:'Notion for students'}}],has_more:false});
  if(path==='/v1/blocks/row-current-1/children'||path==='/v1/blocks/row-current-2/children')return ok({results:[],has_more:false});
  throw new Error(`Unexpected Notion request: ${path} (${options.method||'GET'})`);
};
let status=200,body='';const response={setHeader(){},end(value){body=value;},status(code){status=code;return this;}};
try{
  const token=createSession({id:'current-user'},{token:'current-token',workspace:'Student workspace'});
  await handler({headers:{cookie:`aos_session=${encodeURIComponent(token)}`}},response);
}finally{globalThis.fetch=originalFetch;}
const map=JSON.parse(body);
assert.equal(status,200);
assert.equal(map.partial,false);
assert.deepEqual(map.nodes.workspace.children,['page_rootcurrent']);
assert.deepEqual(map.nodes.page_rootcurrent.children,['db_dbcurrent']);
assert.equal(map.nodes.db_dbcurrent.title,'Notion for students');
assert.deepEqual(map.nodes.db_dbcurrent.database.rows,['row_rowcurrent1','row_rowcurrent2']);
assert.deepEqual(map.nodes.db_dbcurrent.database.sources,[{id:'source-current-1',name:'Courses'},{id:'source-current-2',name:'Assignments'}]);
assert.equal(map.nodes.db_sourcecurrent1,undefined,'a data source must alias the real database, not become a duplicate card');
console.log('current Notion data-source hierarchy fixture passed');
