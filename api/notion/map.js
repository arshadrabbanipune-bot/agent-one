import {getSessionWithNotion} from '../_store.js';

export const maxDuration=60;

const NOTION_VERSION='2026-03-11';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const text=value=>{
  if(Array.isArray(value))return value.map(part=>part?.plain_text||part?.text?.content||'').join('').trim();
  if(typeof value==='string')return value.trim();
  return String(value?.plain_text||value?.text?.content||'').trim();
};
const clean=value=>String(value||'').replace(/\s+/g,' ').trim();
const usefulTitle=value=>{const title=clean(value);return Boolean(title)&&!/^untitled$/i.test(title);};
const nodeKey=(prefix,id)=>`${prefix}_${String(id||'').replace(/[^a-zA-Z0-9]/g,'')}`;

function itemTitle(item){
  for(const value of Object.values(item?.properties||{}))if(value?.type==='title')return text(value.title);
  return text(item?.title)||item?.child_page?.title||item?.child_database?.title||'';
}

// Map cards represent the workspace hierarchy, but the accompanying page
// detail must retain the real Notion blocks as well. Otherwise pages such as
// Recipes look empty even though their headings, lists, and paragraphs exist.
function blockText(block){
  const value=block?.[block?.type]||{};
  if(block?.type==='table_row')return (value.cells||[]).map(text).filter(Boolean).join(' | ');
  return text(value.rich_text)||text(value.caption)||text(value.text)||clean(value.expression)||clean(value.title||block?.child_page?.title||block?.child_database?.title||block?.child_data_source?.title)||'';
}
function blockUrl(value){
  return value?.url||value?.external?.url||value?.file?.url||null;
}

const respond=(res,status,payload)=>{res.statusCode=status;res.end(JSON.stringify(payload));};

export default async function handler(req,res){
  const s=await getSessionWithNotion(req,res);
  res.setHeader('content-type','application/json; charset=utf-8');
  res.setHeader('cache-control','no-store');
  if(!s?.notion?.token)return respond(res,401,{error:'Notion is not connected.'});

  let activeRequests=0;
  const requestQueue=[];
  const runRequest=fn=>new Promise((resolve,reject)=>{
    const run=async()=>{
      activeRequests++;
      try{resolve(await fn());}catch(error){reject(error);}finally{activeRequests--;requestQueue.shift()?.();}
    };
    if(activeRequests<3)run();else requestQueue.push(run);
  });
  const notion=async(path,{method='GET',body,timeout=18_000}={})=>runRequest(async()=>{
    for(let attempt=0;attempt<3;attempt++){
      let response;
      try{response=await fetch(`https://api.notion.com/v1${path}`,{method,headers:{authorization:`Bearer ${s.notion.token}`,'notion-version':NOTION_VERSION,'content-type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(timeout)});}
      catch(error){if(attempt<2){await sleep(250*(2**attempt));continue;}return {ok:false,status:504,json:{message:error?.name==='TimeoutError'?'Notion took too long to respond.':'Notion is temporarily unreachable.'}};}
      const json=await response.json().catch(()=>({}));
      if((response.status===429||response.status>=500)&&attempt<2){await sleep(Math.min(3000,Number(response.headers.get('retry-after')||1)*1000));continue;}
      return {ok:response.ok,status:response.status,json};
    }
  });
  const listChildren=async id=>{
    const results=[];let cursor=null;let more=true;
    while(more){
      const query=new URLSearchParams({page_size:'100'});if(cursor)query.set('start_cursor',cursor);
      const response=await notion(`/blocks/${id}/children?${query}`);
      if(!response?.ok)throw new Error(response?.json?.message||'Notion could not read this page.');
      results.push(...(response.json.results||[]));cursor=response.json.next_cursor||null;more=Boolean(response.json.has_more&&cursor);
    }
    return results;
  };
  try{
    const nodes={workspace:{id:'workspace',notionId:null,title:s.notion.workspace||'My Notion workspace',type:'root',children:[]}};
    const byNotionId=new Map();
    const scanned=new Map();
    const scannedDatabases=new Map();
    const databaseDetails=new Map();
    const state={incomplete:false,scanErrors:0,errors:[],incompleteReason:null};
    const noteError=(message,status=null,id=null)=>{state.scanErrors++;state.incomplete=true;if(state.errors.length<20)state.errors.push({message:clean(message)||'Notion item could not be read.',status,id});};
    const attach=(parentId,childId)=>{
      const child=nodes[childId];if(!child||!nodes[parentId])return;
      if(child.parentId&&nodes[child.parentId])nodes[child.parentId].children=nodes[child.parentId].children.filter(id=>id!==childId);
      child.parentId=parentId;
      if(!nodes[parentId].children.includes(childId))nodes[parentId].children.push(childId);
    };
    const ensureNode=(item,parentId,forcedType)=>{
      const notionId=item?.id;if(!notionId)return null;
      const existing=byNotionId.get(notionId);
      if(existing){
        if(parentId&&existing.type==='database_row')existing.parentId=parentId;
        else if(parentId)attach(parentId,existing.id);
        return existing;
      }
      const title=itemTitle(item);
      // Do not invent labels for unnamed Notion containers. They are not
      // reliable map entities and made the old UI show fake “Untitled
      // database” cards. Untitled rows remain in their real table, but are
      // intentionally displayed without a made-up name.
      const row=forcedType==='database_row';
      const database=forcedType==='database'||item.object==='database'||item.object==='data_source'||item.type==='child_database';
      const type=row?'database_row':database?'database':'page';
      const id=nodeKey(type==='database'?'db':type==='database_row'?'row':'page',notionId);
      const fallbackTitle='';
      const node={id,notionId,title:usefulTitle(title)?title:fallbackTitle,type,hidden:!row&&!usefulTitle(title),children:[],content:[],url:item.url||null,properties:item.properties||undefined};
      nodes[id]=node;byNotionId.set(notionId,node);
      if(parentId&&row)node.parentId=parentId;
      else if(parentId)attach(parentId,id);
      return node;
    };
    const readDatabaseDetails=async notionId=>{
      if(databaseDetails.has(notionId))return databaseDetails.get(notionId);
      const task=(async()=>{
        let databaseResponse=await notion(`/databases/${notionId}`),source=null,database=null;
        if(databaseResponse?.ok)database=databaseResponse.json;
        else{
          const sourceResponse=await notion(`/data_sources/${notionId}`);
          if(!sourceResponse?.ok){noteError(sourceResponse?.json?.message||databaseResponse?.json?.message,sourceResponse?.status||databaseResponse?.status,notionId);return null;}
          source=sourceResponse.json;
          const databaseId=source?.parent?.database_id;
          if(databaseId){databaseResponse=await notion(`/databases/${databaseId}`);if(databaseResponse?.ok)database=databaseResponse.json;}
          if(!database)database={object:'database',id:databaseId||notionId,parent:source?.database_parent||source?.parent,data_sources:[{id:source.id,name:itemTitle(source)}],title:source.title||[],url:source.url||null};
        }
        const sourceRefs=(database.data_sources?.length?database.data_sources:source?[{id:source.id,name:itemTitle(source)}]:[]).filter(item=>item?.id);
        const sources=[];
        if(!sourceRefs.length&&databaseResponse?.ok)sources.push({id:database.id||notionId,name:itemTitle(database),schema:database,legacy:true});
        for(const ref of sourceRefs){
          let schema=source?.id===ref.id?source:null;
          if(!schema){const response=await notion(`/data_sources/${ref.id}`);if(response?.ok)schema=response.json;else noteError(response?.json?.message,response?.status,ref.id);}
          if(schema)sources.push({id:ref.id,name:clean(ref.name)||itemTitle(schema),schema});
        }
        if(!sources.length)sources.push({id:notionId,name:itemTitle(database),schema:database});
        return {database,databaseId:database.id||notionId,sources};
      })();
      databaseDetails.set(notionId,task);
      const details=await task;
      if(details){databaseDetails.set(details.databaseId,Promise.resolve(details));for(const source of details.sources)databaseDetails.set(source.id,Promise.resolve(details));}
      return details;
    };
    const ensureDatabase=async(item,parentId)=>{
      const direct=byNotionId.get(item?.id);if(direct){if(parentId)attach(parentId,direct.id);return direct;}
      const details=await readDatabaseDetails(item?.id);if(!details)return null;
      const aliases=[details.databaseId,...details.sources.map(source=>source.id)];
      const existing=aliases.map(id=>byNotionId.get(id)).find(Boolean);
      if(existing){for(const id of aliases)byNotionId.set(id,existing);if(parentId)attach(parentId,existing.id);return existing;}
      const title=itemTitle(details.database)||details.sources.map(source=>source.name||itemTitle(source.schema)).find(usefulTitle)||itemTitle(item);
      const node=ensureNode({...details.database,id:details.databaseId,object:'database',title:[{plain_text:title}],url:details.database.url||item.url||null},parentId,'database');
      if(node){node.hidden=!usefulTitle(title);node.notionParent=details.database.parent||null;for(const id of aliases)byNotionId.set(id,node);}
      return node;
    };
    const scanDatabase=async node=>{
      if(!node)return;
      if(scannedDatabases.has(node.notionId))return scannedDatabases.get(node.notionId);
      const task=(async()=>{
        const details=await readDatabaseDetails(node.notionId);if(!details)return;
        const resolvedTitle=itemTitle(details.database)||details.sources.map(source=>source.name||itemTitle(source.schema)).find(usefulTitle)||'';
        if(usefulTitle(resolvedTitle)){node.title=resolvedTitle;node.hidden=false;}
        node.url=details.database.url||details.sources[0]?.schema?.url||node.url;
        const existingRows=(node.database?.rows||[]).filter(id=>nodes[id]?.type==='database_row');
        node.children=node.children.filter(id=>nodes[id]?.type!=='database_row');
        const properties={};for(const source of details.sources)Object.assign(properties,source.schema?.properties||{});
        node.database={properties,rows:existingRows,hasMore:false,sources:details.sources.map(source=>({id:source.id,name:source.name||''}))};
        for(const source of details.sources){
          byNotionId.set(source.id,node);let cursor=null,more=true;
          while(more){
            const body={page_size:100};if(cursor)body.start_cursor=cursor;
            let response=source.legacy?await notion(`/databases/${details.databaseId}/query`,{method:'POST',body}):await notion(`/data_sources/${source.id}/query`,{method:'POST',body});
            if(!response?.ok&&!source.legacy&&details.sources.length===1){response=await notion(`/databases/${details.databaseId}/query`,{method:'POST',body});}
            if(!response?.ok){noteError(response?.json?.message,response?.status,source.id);break;}
            for(const row of response.json.results||[]){
              if(row.object==='data_source'){
                const child=await ensureDatabase(row,node.id);if(child&&child.id!==node.id)await scanDatabase(child);continue;
              }
              if(row.object!=='page')continue;
              const rowId=nodeKey('row',row.id),title=itemTitle(row);let rowNode=nodes[rowId];
              if(!rowNode){rowNode=nodes[rowId]={id:rowId,notionId:row.id,title:usefulTitle(title)?title:'',type:'database_row',children:[],content:[],parentId:node.id,url:row.url||null,properties:row.properties||{}};byNotionId.set(row.id,rowNode);}
              else{rowNode.title=usefulTitle(title)?title:'';rowNode.url=row.url||rowNode.url;rowNode.properties=row.properties||rowNode.properties;rowNode.parentId=node.id;}
              if(!node.database.rows.includes(rowId))node.database.rows.push(rowId);
            }
            cursor=response.json.next_cursor||null;more=Boolean(response.json.has_more&&cursor);
          }
        }
        await Promise.all(node.database.rows.map(rowId=>scanPage(nodes[rowId])));
      })();
      scannedDatabases.set(node.notionId,task);return task;
    };
    const scanPage=async node=>{
      if(!node||node.type==='database')return scanDatabase(node);
      if(scanned.has(node.notionId))return scanned.get(node.notionId);
      const task=(async()=>{
        const inspectedBlocks=new Set();
        node.content??=[];
        const inspectContainer=async(blockId,targetContent)=>{
          if(inspectedBlocks.has(blockId))return;
          inspectedBlocks.add(blockId);
          let blocks=[];try{blocks=await listChildren(blockId);}catch(error){noteError(error?.message,null,blockId);return;}
          const descendants=[];
          for(const block of blocks){
            if(block.type==='child_page'){
              let child=byNotionId.get(block.id);
              if(!child){const pageResponse=await notion(`/pages/${block.id}`);const page=pageResponse?.ok?pageResponse.json:{...block,id:block.id,object:'page',title:[{plain_text:block.child_page?.title||''}]};child=ensureNode(page,node.id);}
              else attach(node.id,child.id);
              if(child)descendants.push(scanPage(child));
            }else if(block.type==='child_database'||block.type==='child_data_source'){
              const child=await ensureDatabase({...block,id:block.id,object:'database',title:[{plain_text:block.child_database?.title||block.child_data_source?.title||''}]},node.id);
              if(child)descendants.push(scanDatabase(child));
            }else{
              // Keep all ordinary Notion blocks in their original order. Empty
              // containers remain when they have children, preserving toggles,
              // columns, tables, and other real nesting without inventing text.
              const value=block?.[block.type]||{};
              // Keep the exact readable Notion payload for every ordinary
              // block. This includes non-text blocks (files, media,
              // bookmarks, equations, linked pages, dividers, etc.) that a
              // heading-only renderer could otherwise silently discard.
              const entry={id:block.id,type:block.type,text:blockText(block),checked:typeof value.checked==='boolean'?value.checked:undefined,url:blockUrl(value),data:value,children:[]};
              targetContent.push(entry);
              if(block.has_children)descendants.push(inspectContainer(block.id,entry.children));
              if(block.type==='meeting_notes')for(const key of ['summary_block_id','notes_block_id','transcript_block_id'])if(value?.[key])descendants.push(inspectContainer(value[key],entry.children));
            }
          }
          await Promise.all(descendants);
        };
        await inspectContainer(node.notionId,node.content);
      })();
      scanned.set(node.notionId,task);return task;
    };
    const results=[];let cursor=null;let more=true;
    while(more){
      const body={page_size:100};if(cursor)body.start_cursor=cursor;
      const response=await notion('/search',{method:'POST',body});
      if(!response?.ok)throw new Error(response?.json?.message||'Notion search failed.');
      results.push(...(response.json.results||[]));
      if(response.json?.request_status?.incomplete_reason){state.incomplete=true;state.incompleteReason=response.json.request_status.incomplete_reason;}
      cursor=response.json.next_cursor||null;more=Boolean(response.json.has_more&&cursor);
    }
    // Build every searchable page first, then attach it using Notion's parent
    // metadata. This avoids flattening child pages into the workspace root.
    const databaseResults=results.filter(item=>['database','data_source'].includes(item.object));
    const pageResults=results.filter(item=>item.object==='page');
    // Prefer database shells before their data-source aliases. Processing this
    // sequentially lets aliases point to the one actual table instead of
    // creating duplicate nodes from the search response.
    const databaseNodes=[];
    for(const item of [...databaseResults.filter(item=>item.object==='database'),...databaseResults.filter(item=>item.object==='data_source')]){
      const node=await ensureDatabase(item,null);
      if(node&&!databaseNodes.includes(node))databaseNodes.push(node);
    }
    const standalonePages=[];
    for(const item of pageResults){
      const sourceId=item.parent?.data_source_id||item.parent?.database_id;
      if(sourceId){
        continue;
      }
      const node=ensureNode(item,null);if(node)standalonePages.push({item,node});
    }
    // Query database metadata before mapping search rows: it gives us the
    // data-source aliases that rows use as their real parent.
    await Promise.all(databaseNodes.map(scanDatabase));
    for(const item of pageResults){
      const sourceId=item.parent?.data_source_id||item.parent?.database_id;
      if(!sourceId)continue;
      // If Notion did not return the real parent table, do not fabricate one
      // at the workspace root. A refresh after granting the table access will
      // include it with its genuine title and position.
      const database=byNotionId.get(sourceId);
      const row=ensureNode(item,database?.id,'database_row');
      if(database&&row){
        database.database??={properties:{},rows:[]};
        if(!database.database.rows.includes(row.id))database.database.rows.push(row.id);
      }
    }
    const ensurePageParent=async item=>{
      const parentId=item?.parent?.page_id;if(!parentId)return null;
      const existing=byNotionId.get(parentId);if(existing)return existing;
      const response=await notion(`/pages/${parentId}`);
      if(!response?.ok){noteError(response?.json?.message||'A parent page is not shared with this integration.',response?.status,parentId);return null;}
      const parent=ensureNode(response.json,null);if(!parent)return null;
      const ancestor=await ensurePageParent(response.json);
      if(ancestor)attach(ancestor.id,parent.id);else attach('workspace',parent.id);
      return parent;
    };
    // Page parent IDs are authoritative for normal page hierarchy. Inline
    // database/page blocks are then reattached during the recursive scan in
    // their exact Notion block order.
    for(const {item,node} of standalonePages){
      const parent=byNotionId.get(item.parent?.page_id)||await ensurePageParent(item);
      if(parent)attach(parent.id,node.id);
      else if(item.parent?.type==='workspace'||item.parent?.workspace)attach('workspace',node.id);
      else{attach('workspace',node.id);node.accessNote='Shared directly; its parent is not available to this integration.';state.incomplete=true;}
    }
    for(const item of databaseResults){
      const database=byNotionId.get(item.id);if(!database)continue;
      const canonicalParent=database.notionParent||item.parent;
      const parent=byNotionId.get(canonicalParent?.page_id)||await ensurePageParent({parent:canonicalParent});
      if(parent)attach(parent.id,database.id);
      else if(canonicalParent?.type==='workspace'||canonicalParent?.workspace)attach('workspace',database.id);
      else{attach('workspace',database.id);database.accessNote='Shared directly; its parent is not available to this integration.';state.incomplete=true;}
    }
    const roots=Object.values(nodes).filter(node=>node.id!=='workspace'&&node.parentId==='workspace');
    await Promise.all(roots.map(node=>node.type==='database'?scanDatabase(node):scanPage(node)));
    // Untitled containers are real traversal points, but they are not useful
    // visual cards. Promote their titled descendants without inventing names.
    for(const node of Object.values(nodes)){
      if(!node?.hidden||node.id==='workspace')continue;
      const parentId=nodes[node.parentId]?.id||'workspace';
      const promoted=[...(node.children||[])];
      if(node.type==='database')for(const rowId of node.database?.rows||[])promoted.push(...(nodes[rowId]?.children||[]));
      for(const childId of promoted)if(nodes[childId]&&!nodes[childId].hidden)attach(parentId,childId);
      if(nodes[parentId])nodes[parentId].children=nodes[parentId].children.filter(id=>id!==node.id);
    }
    const finalRoots=Object.values(nodes).filter(node=>node.id!=='workspace'&&!node.hidden&&node.parentId==='workspace');
    // Search is intentionally broad and can return content whose parent was
    // not shared with the integration. Keep only the graph reachable from the
    // real workspace root; this prevents a search hit from becoming a false
    // top-level item or inflating the live-map totals.
    const visible=new Set(['workspace']);
    const visit=id=>{
      if(visible.has(id))return;
      visible.add(id);
      for(const childId of nodes[id]?.children||[])visit(childId);
    };
    for(const root of finalRoots)visit(root.id);
    // Database rows deliberately are not visual children: rendering every row
    // as a map card makes a workspace unusable. They do, however, belong to a
    // visible database and must remain in the payload for its live, scrollable
    // table. Mark the canonical row IDs as reachable before pruning, repairing
    // parent references along the way in case Notion returned a data-source
    // alias during search.
    for(const node of Object.values(nodes)){
      if(node.type!=='database'||!visible.has(node.id))continue;
      const rowIds=[];
      for(const rowId of node.database?.rows||[]){
        const row=nodes[rowId];
        if(!row||row.type!=='database_row')continue;
        row.parentId=node.id;
        visible.add(rowId);
        // Rows are not map cards, but their nested approved pages/databases
        // remain part of the workspace graph and must survive pruning.
        for(const childId of row.children||[])visit(childId);
        rowIds.push(rowId);
      }
      if(node.database)node.database.rows=rowIds;
    }
    for(const [id,node] of Object.entries(nodes)){
      if(id==='workspace')continue;
      if(!visible.has(id))delete nodes[id];
    }
    const countByType=type=>Object.values(nodes).filter(node=>node.type===type).length;
    // Database rows are intentionally stored in their parent table's row list,
    // not as visual map cards. Count that canonical list so the live-scan
    // number exactly matches the scrollable tables users can open.
    const databaseRows=Object.values(nodes).filter(node=>node.type==='database').reduce((total,node)=>total+(node.database?.rows||[]).filter(id=>nodes[id]).length,0);
    respond(res,200,{workspace:s.notion.workspace||'Notion workspace',rootNodeId:'workspace',nodes,scannedAt:new Date().toISOString(),stats:{items:Object.keys(nodes).length-1,pages:countByType('page'),databases:countByType('database'),databaseRows},partial:state.incomplete,scanErrors:state.scanErrors,scanErrorDetails:state.errors,incompleteReason:state.incompleteReason,has_more:false});
  }catch(error){respond(res,500,{error:error?.message||'The live Notion map could not be created. Please reconnect Notion and try again.'});}
}
