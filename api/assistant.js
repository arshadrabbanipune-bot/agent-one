import {env,sign,verify} from './_auth.js';
import {getSessionWithNotion,getAssistantSettings,saveAssistantSettings,createAssistantRun,updateAssistantRun,createAssistantAction,getAssistantAction,findActionByIdempotencyKey,markAssistantActionUndone,listAssistantRuns} from './_store.js';
import {createNotionClient,notionToolSchemas,notionTitle,notionBlockText} from './_notion.js';
import {DEFAULT_AGENT_MODEL,DEFAULT_TIMEZONE,DEFAULT_TRANSCRIBE_MODEL,WRITE_TOOLS,assertToolArguments,buildAgentInstructions,cleanText,confirmationDecision,confirmationSummary,idempotencyKey,isExplicitWriteCommand,isValidTimezone,resolveRelativeDate,responseText,responseToolCalls,sanitizeForModel,validateAssistantBody} from './_assistantCore.js';

export const maxDuration=60;
const MAX_BODY=4_200_000,MAX_AUDIO=2_700_000,MAX_COMMAND=2000,MAX_TOOL_CALLS=12,MAX_WRITES=4;
const allowedAudio=new Set(['audio/webm','audio/ogg','audio/mp4','audio/mpeg','audio/wav','audio/x-wav']);
const buckets=new Map();
const json=(res,status,payload)=>{res.statusCode=status;res.setHeader('content-type','application/json; charset=utf-8');res.setHeader('cache-control','no-store');res.end(JSON.stringify(payload));};
const readBody=req=>{
  if(req.body&&typeof req.body==='object')return Promise.resolve(req.body);
  if(typeof req.body==='string'){if(req.body.length>MAX_BODY)return Promise.reject(new Error('Request is too large.'));try{return Promise.resolve(JSON.parse(req.body||'{}'));}catch{return Promise.reject(new Error('Invalid JSON request.'));}}
  return new Promise((resolve,reject)=>{let body='';req.on('data',part=>{body+=part;if(body.length>MAX_BODY)reject(new Error('Request is too large.'));});req.on('end',()=>{try{resolve(JSON.parse(body||'{}'));}catch{reject(new Error('Invalid JSON request.'));}});req.on('error',reject);});
};
const readTextBody=req=>new Promise((resolve,reject)=>{if(typeof req.body==='string')return resolve(req.body);let body='';req.on('data',part=>{body+=part;if(body.length>220_000)reject(new Error('Realtime session request is too large.'));});req.on('end',()=>resolve(body));req.on('error',reject);});
const rateLimit=(userId,kind,limit=16)=>{const key=`${userId}:${kind}`,now=Date.now(),recent=(buckets.get(key)||[]).filter(value=>value>now-60_000);if(recent.length>=limit)return false;recent.push(now);buckets.set(key,recent);return true;};
const safetyId=userId=>`aos_${String(userId).replace(/[^a-zA-Z0-9_-]/g,'').slice(0,64)}`;
async function openAIJson(path,{method='POST',body,headers={},userId,timeout=55_000}={}){
  const key=env('OPENAI_API_KEY');if(!key)throw new Error('The voice assistant is not configured on the server yet.');
  const response=await fetch(`https://api.openai.com/v1${path}`,{method,headers:{authorization:`Bearer ${key}`,'OpenAI-Safety-Identifier':safetyId(userId),...headers},body,signal:AbortSignal.timeout(timeout)});
  const text=await response.text();let value={};try{value=text?JSON.parse(text):{};}catch{value={text};}
  if(!response.ok){
    const quotaCode=cleanText(value?.error?.code||value?.error?.type);
    console.warn(JSON.stringify({event:'openai_request_failed',path,status:response.status,code:quotaCode.slice(0,80),requestId:response.headers?.get?.('x-request-id')||null}));
    const message=response.status===429&&/insufficient_quota|billing/i.test(quotaCode)?'The OpenAI project has no available quota. Add credits or raise its project limit, then retry. No Notion change was made.':response.status===429?'The assistant is temporarily rate-limited. Wait a moment and retry; no Notion change was made.':response.status===401?'The server OpenAI credential was rejected.':value?.error?.message||`OpenAI request failed (${response.status}).`;
    const error=new Error(cleanText(message).slice(0,400));error.status=response.status;error.code=quotaCode;throw error;
  }
  return value;
}
const startStream=res=>{res.statusCode=200;res.setHeader('content-type','text/event-stream; charset=utf-8');res.setHeader('cache-control','no-cache, no-transform');res.setHeader('connection','keep-alive');res.setHeader('x-accel-buffering','no');res.flushHeaders?.();return event=>res.write(`data: ${JSON.stringify(event)}\n\n`);};
const finishStream=(res,send)=>{send({type:'session_completed'});res.end();};
const toolLabel=name=>({search_notion_workspace:'Searching Notion',fetch_notion_object:'Reading a Notion object',query_notion_collection:'Finding the matching entry',inspect_notion_structure:'Inspecting existing structure',append_notion_blocks:'Adding content safely',update_notion_page_properties:'Updating page properties',update_notion_block:'Updating one block',create_notion_page:'Creating a page',archive_notion_object:'Archiving content'}[name]||'Working in Notion');
const targetId=(name,args)=>args.parentBlockId||args.pageId||args.blockId||args.parentId||args.objectId||'';
async function targetInfo(client,id){
  if(!id)return {id:'',title:'',url:null,lastEditedTime:null};
  for(const type of ['page','block'])try{const value=await client.fetchObject({objectId:id,objectType:type,includeChildren:false,pageSize:20});return {id,title:value.title||'',url:value.url||null,lastEditedTime:value.lastEditedTime||null};}catch{}
  return {id,title:'',url:null,lastEditedTime:null};
}
const describeResult=(name,result,target)=>{
  if(result?.status==='already_present'||result?.status==='already_completed')return `${target?.title||'That Notion location'} already contains this change, so nothing was duplicated.`;
  if(name==='append_notion_blocks')return `Added ${result?.added?.length||result?.createdBlockIds?.length||1} item${(result?.added?.length||result?.createdBlockIds?.length||1)===1?'':'s'} to ${target?.title||'Notion'} without replacing existing content.`;
  if(name==='update_notion_page_properties')return `Updated the requested properties on ${target?.title||'the Notion page'}.`;
  if(name==='update_notion_block')return `Updated the selected block in ${target?.title||'Notion'}.`;
  if(name==='create_notion_page')return `Created “${result?.title||target?.title||'the new page'}” in Notion.`;
  if(name==='archive_notion_object')return 'Archived the selected Notion content.';
  return 'The Notion action completed successfully.';
};

async function executeTool({name,args,client,req,res,runId,userId,command,date}){
  assertToolArguments(name,args);
  if(name==='search_notion_workspace')return client.search(args);
  if(name==='fetch_notion_object')return client.fetchObject(args);
  if(name==='query_notion_collection')return client.queryCollection(args);
  if(name==='inspect_notion_structure')return client.inspect(args);
  const key=idempotencyKey({userId,command,tool:name,args,date});
  const existing=await findActionByIdempotencyKey(req,res,key).catch(()=>null);
  if(existing)return {status:'already_completed',verified:true,actionId:existing.id,targetTitle:existing.target_title,targetUrl:existing.target_url};
  const beforeTarget=await targetInfo(client,targetId(name,args));let result,before={},after={},undo=null,actionType=name;
  if(name==='append_notion_blocks'){
    before={targetLastEditedTime:beforeTarget.lastEditedTime};result=await client.appendBlocks({...args,idempotencyKey:key});after={added:result.added||[],createdBlockIds:result.createdBlockIds||[]};
    if(result.status==='already_present')return {...result,targetTitle:beforeTarget.title,targetUrl:beforeTarget.url};
    undo=result.createdBlockIds?.length?{type:'archive_blocks',blockIds:result.createdBlockIds}:null;actionType='append_blocks';
  }else if(name==='update_notion_page_properties'){
    result=await client.updatePageProperties(args);const names=args.updates.map(item=>item.name);before={properties:Object.fromEntries(names.map(key=>[key,result.previousProperties?.[key]??null]))};after={page:result.after,updates:args.updates};undo={type:'restore_properties',pageId:args.pageId,properties:before.properties,expectedLastEditedTime:result.after?.lastEditedTime||null};actionType='update_properties';
  }else if(name==='update_notion_block'){
    result=await client.updateBlock(args);before=result.before;after=result.after;undo={type:'restore_block',blockId:args.blockId,before:result.before,expectedCurrentText:result.after?.text||null};actionType='update_block';
  }else if(name==='create_notion_page'){
    result=await client.createPage({...args,idempotencyKey:key});before={parentId:args.parentId};after={id:result.id,title:result.title,url:result.url};undo={type:'archive_page',pageId:result.id};actionType='create_page';
  }else if(name==='archive_notion_object'){
    before=beforeTarget;result=await client.archiveObject(args);after=result;actionType='archive';
  }else throw new Error('Unsupported Notion write tool.');
  if(!result?.verified)throw new Error('Notion did not verify the requested change.');
  const target=name==='create_notion_page'?{id:result.id,title:result.title,url:result.url}:beforeTarget;
  const action=await createAssistantAction(req,res,{runId,toolName:name,targetId:target.id,targetTitle:target.title,targetUrl:target.url,actionType,before:sanitizeForModel(before),after:sanitizeForModel(after),undo,idempotencyKey:key,status:'completed'}).catch(error=>{console.warn(JSON.stringify({event:'assistant_audit_store_failed',runId,tool:name,message:cleanText(error?.message).slice(0,160)}));return {id:null,persisted:false};});
  return {...sanitizeForModel(result),actionId:action.id,targetTitle:target.title,targetUrl:target.url,summary:describeResult(name,result,target),undoAvailable:Boolean(undo&&action.persisted),auditPersisted:Boolean(action.persisted)};
}

async function realtimeSession(req,res,current){
  if(!rateLimit(current.user.id,'realtime',8))return json(res,429,{error:'Too many live voice sessions. Wait a minute and try again.'});
  const sdp=await readTextBody(req);if(!sdp||!/^v=0/m.test(sdp))return json(res,400,{error:'The live voice connection offer was invalid.'});
  const key=env('OPENAI_API_KEY');if(!key)return json(res,503,{error:'Live voice is not configured on the server.'});
  const form=new FormData();form.set('sdp',sdp);form.set('session',JSON.stringify({type:'realtime',model:'gpt-realtime-2.1',instructions:'Transcribe the user accurately in English, Hindi, or Hinglish. Do not answer; the protected Notion agent will handle the command.',audio:{input:{transcription:{model:'gpt-4o-mini-transcribe',prompt:'Agent One, Notion, Daily Entry, mind map, exercise, workout, health.'},turn_detection:{type:'server_vad',silence_duration_ms:750,create_response:false,interrupt_response:true}},output:{voice:'marin'}}}));
  const response=await fetch('https://api.openai.com/v1/realtime/calls',{method:'POST',headers:{authorization:`Bearer ${key}`,'OpenAI-Safety-Identifier':safetyId(current.user.id)},body:form,signal:AbortSignal.timeout(18_000)});
  const answer=await response.text();if(!response.ok){let value={};try{value=JSON.parse(answer);}catch{}const error=new Error(response.status===429?'Live voice is temporarily busy. The browser voice fallback will be used.':value?.error?.message||`Live voice could not start (${response.status}).`);error.status=response.status;throw error;}
  res.statusCode=200;res.setHeader('content-type','application/sdp');res.setHeader('cache-control','no-store');res.end(answer);
}

async function transcribe(req,res,current,body){
  if(!rateLimit(current.user.id,'transcribe',10))return json(res,429,{error:'Too many transcription requests. Wait a minute and try again.'});
  const mimeType=cleanText(body.mimeType).split(';')[0].toLowerCase(),durationMs=Number(body.durationMs||0),encoded=String(body.audioBase64||'').replace(/^data:[^,]+,/,'');
  if(!allowedAudio.has(mimeType))return json(res,415,{error:'This audio format is not supported. Try recording again.'});if(!Number.isFinite(durationMs)||durationMs<200||durationMs>60_500)return json(res,400,{error:'Record between one second and sixty seconds.'});
  let bytes;try{bytes=Buffer.from(encoded,'base64');}catch{return json(res,400,{error:'The recording could not be decoded.'});}if(!bytes.length)return json(res,400,{error:'The recording was empty.'});if(bytes.length>MAX_AUDIO)return json(res,413,{error:'The recording is too large. Keep it under sixty seconds.'});
  const extension=mimeType.includes('webm')?'webm':mimeType.includes('ogg')?'ogg':mimeType.includes('mp4')?'m4a':mimeType.includes('mpeg')?'mp3':'wav';const form=new FormData();form.append('file',new Blob([bytes],{type:mimeType}),`command.${extension}`);form.append('model',env('OPENAI_TRANSCRIBE_MODEL')||DEFAULT_TRANSCRIBE_MODEL);form.append('response_format','json');form.append('prompt','Agent One Notion assistant. The speaker may use English, Hindi, or Hinglish. Preserve Notion names, Daily Entry, map, task, exercise, workout, health.');
  const value=await openAIJson('/audio/transcriptions',{body:form,userId:current.user.id,timeout:60_000});const transcript=cleanText(value.text);if(!transcript)return json(res,422,{error:'I could not hear a usable command. Try again or type it.'});return json(res,200,{transcript});
}

async function runAgent(req,res,current,body){
  const command=cleanText(body.command);if(!command||command.length>MAX_COMMAND)return json(res,400,{error:'Enter a command between 1 and 2,000 characters.'});if(!current.notion?.token)return json(res,409,{error:'Connect Notion before using the assistant.'});if(!rateLimit(current.user.id,'run',12))return json(res,429,{error:'Too many assistant requests. Wait a minute and try again.'});
  const send=startStream(res),model=env('OPENAI_AGENT_MODEL')||DEFAULT_AGENT_MODEL,inputType=body.inputType==='voice'?'voice':'text';send({type:'session_started'});send({type:'intent_detected',summary:command.slice(0,180)});
  const settingsResult=await getAssistantSettings(req,res).catch(()=>({settings:null})),settings=settingsResult.settings||{timezone:DEFAULT_TIMEZONE,confirmationPreference:'risk_based'};const timezone=isValidTimezone(settings.timezone)?settings.timezone:DEFAULT_TIMEZONE;const relative=resolveRelativeDate(command,new Date(),timezone);
  const run=await createAssistantRun(req,res,{inputType,transcript:command,status:'running',model,intent:{relativeDate:relative}}).catch(()=>({id:cryptoRandomId(),persisted:false}));const runId=run.id,client=createNotionClient(current.notion.token),instructions=buildAgentInstructions({user:current.user,timeZone:timezone,settings});
  let input=[{role:'user',content:[{type:'input_text',text:`User command: ${command}\nResolved relative date: ${JSON.stringify(relative)}\nUse the connected Notion tools to inspect, act safely, and verify.`}]}],toolCount=0,writeCount=0,usage={},actions=[];
  try{
    for(let turn=0;turn<8;turn++){
      const response=await openAIJson('/responses',{userId:current.user.id,body:JSON.stringify({model,instructions,input,tools:notionToolSchemas,tool_choice:'auto',parallel_tool_calls:false,store:false,include:['reasoning.encrypted_content'],reasoning:{effort:'medium'},safety_identifier:safetyId(current.user.id)}),headers:{'content-type':'application/json'},timeout:42_000});usage=response.usage||usage;const calls=responseToolCalls(response);
      if(!calls.length){
        const modelText=responseText(response);
        if(!actions.length&&isExplicitWriteCommand(command)){
          const message=modelText||'I did not make a Notion change because I could not identify one exact approved target. Name the page or database and the precise change, then try again.';
          await updateAssistantRun(req,res,runId,{status:'failed',error:message,usage}).catch(()=>false);send({type:'action_failed',message,retryable:false,noWritePerformed:true});finishStream(res,send);return;
        }
        const summary=modelText||(actions.length?actions.map(item=>item.summary).filter(Boolean).join(' '):'I checked the connected Notion content. No change was requested or performed.');
        await updateAssistantRun(req,res,runId,{status:'completed',intent:{relativeDate:relative,summary},usage}).catch(()=>false);send({type:'action_completed',result:{runId,summary,actions,completedAt:new Date().toISOString()}});finishStream(res,send);return;
      }
      input.push(...(response.output||[]));const outputs=[];
      for(const call of calls){if(++toolCount>MAX_TOOL_CALLS)throw new Error('This command needed too many Notion operations. Narrow the request and try again.');let args;try{args=JSON.parse(call.arguments||'{}');}catch{throw new Error('The assistant produced invalid tool arguments.');}assertToolArguments(call.name,args);
        if(WRITE_TOOLS.has(call.name)){if(++writeCount>MAX_WRITES)throw new Error('This command would make too many Notion changes at once. Split it into smaller requests.');const decision=confirmationDecision(call.name,args,{command,settings});if(decision.required){const token=sign({kind:'assistant_confirmation',userId:current.user.id,runId,command,inputType,toolName:call.name,args,timezone,exp:Date.now()+10*60_000});await updateAssistantRun(req,res,runId,{status:'waiting_confirmation',intent:{relativeDate:relative,tool:call.name}}).catch(()=>false);send({type:'confirmation_required',plan:{summary:confirmationSummary(call.name,args),reason:decision.reason,tool:call.name},confirmationToken:token});finishStream(res,send);return;}}
        const label=toolLabel(call.name);send({type:'tool_started',tool:call.name,label});const result=await executeTool({name:call.name,args,client,req,res,runId,userId:current.user.id,command,date:relative.date||new Date().toISOString().slice(0,10)});send({type:'tool_completed',tool:call.name,label});if(result?.actionId)actions.push({actionId:result.actionId,summary:result.summary||describeResult(call.name,result,{title:result.targetTitle}),targetTitle:result.targetTitle||'',targetUrl:result.targetUrl||null,undoAvailable:Boolean(result.undoAvailable)});outputs.push({type:'function_call_output',call_id:call.call_id,output:JSON.stringify(sanitizeForModel(result))});
      }
      input.push(...outputs);
    }
    throw new Error('The assistant could not finish within the safe tool limit. Narrow the command and retry.');
  }catch(error){await updateAssistantRun(req,res,runId,{status:actions.length?'partial':'failed',error:cleanText(error.message).slice(0,500),usage}).catch(()=>false);send({type:'action_failed',message:cleanText(error.message)||'The assistant could not complete the request.',retryable:[429,500,502,503,504].includes(error.status),partialActions:actions});finishStream(res,send);}
}

async function confirmAction(req,res,current,body){
  const payload=verify(body.confirmationToken);if(!payload||payload.kind!=='assistant_confirmation'||payload.userId!==current.user.id)return json(res,400,{error:'This confirmation expired or does not belong to you.'});if(!current.notion?.token)return json(res,409,{error:'Reconnect Notion before confirming this change.'});
  const send=startStream(res),client=createNotionClient(current.notion.token);try{send({type:'session_started'});send({type:'tool_started',tool:payload.toolName,label:toolLabel(payload.toolName)});const result=await executeTool({name:payload.toolName,args:payload.args,client,req,res,runId:payload.runId,userId:current.user.id,command:payload.command,date:new Date().toISOString().slice(0,10)});send({type:'tool_completed',tool:payload.toolName,label:toolLabel(payload.toolName)});const action={actionId:result.actionId,summary:result.summary||describeResult(payload.toolName,result,{title:result.targetTitle}),targetTitle:result.targetTitle||'',targetUrl:result.targetUrl||null,undoAvailable:Boolean(result.undoAvailable)};await updateAssistantRun(req,res,payload.runId,{status:'completed',intent:{confirmedTool:payload.toolName}}).catch(()=>false);send({type:'action_completed',result:{runId:payload.runId,summary:action.summary,actions:[action],completedAt:new Date().toISOString()}});finishStream(res,send);}catch(error){await updateAssistantRun(req,res,payload.runId,{status:'failed',error:cleanText(error.message)}).catch(()=>false);send({type:'action_failed',message:cleanText(error.message),retryable:false});finishStream(res,send);}
}

async function undoAction(req,res,current,body){
  if(!current.notion?.token)return json(res,409,{error:'Reconnect Notion before undoing a change.'});const action=await getAssistantAction(req,res,cleanText(body.actionId));if(!action)return json(res,404,{error:'That assistant action was not found.'});if(action.undo_status!=='available')return json(res,409,{error:'This action is no longer available to undo.'});
  const client=createNotionClient(current.notion.token),undo=action.undo_payload||{};
  try{
    if(undo.type==='archive_blocks'){for(const blockId of undo.blockIds||[])await client.archiveObject({objectId:blockId,objectType:'block'});}
    else if(undo.type==='archive_page')await client.archiveObject({objectId:undo.pageId,objectType:'page'});
    else if(undo.type==='restore_properties'){const page=await client.fetchObject({objectId:undo.pageId,objectType:'page',includeChildren:false,pageSize:10});if(undo.expectedLastEditedTime&&page.lastEditedTime!==undo.expectedLastEditedTime)return json(res,409,{error:'The page changed after the assistant edit, so automatic undo was stopped to protect newer work.'});await client.request(`/pages/${undo.pageId}`,{method:'PATCH',body:{properties:undo.properties}});}
    else if(undo.type==='restore_block')await client.updateBlock({blockId:undo.blockId,type:undo.before.type,text:undo.before.text,checked:undo.before.checked,expectedPreviousText:undo.expectedCurrentText});
    else return json(res,409,{error:'This action cannot be safely undone.'});
    await markAssistantActionUndone(req,res,action.id,'undone');return json(res,200,{ok:true,message:'The assistant change was undone without touching unrelated content.'});
  }catch(error){await markAssistantActionUndone(req,res,action.id,'failed').catch(()=>false);return json(res,502,{error:cleanText(error.message)||'Undo failed. No unrelated content was changed.'});}
}

const scoreCandidate=item=>{const title=item.title.toLowerCase();let score=0;if(/daily|journal|entry|today/.test(title))score+=8;if(/map|mind|life/.test(title))score+=7;if(/health|exercise|workout|habit/.test(title))score+=5;if(item.type==='database'||item.type==='data_source')score+=1;return score;};
async function settingsResponse(req,res,current){
  if(!current.notion?.token)return json(res,409,{error:'Connect Notion before configuring the assistant.'});const stored=await getAssistantSettings(req,res).catch(()=>({settings:null}));const client=createNotionClient(current.notion.token);const candidates=(await client.search({query:'',objectTypes:['page','database','data_source'],maxResults:50})).sort((a,b)=>scoreCandidate(b)-scoreCandidate(a));return json(res,200,{settings:stored.settings||{timezone:DEFAULT_TIMEZONE,confirmationPreference:'risk_based',voiceResponsePreference:true,defaultInsertionBehavior:'match_existing'},candidates:candidates.map(item=>({id:item.id,title:item.title,type:item.type,url:item.url}))});
}
async function saveSettingsAction(req,res,body){
  const value={dailyEntrySourceId:cleanText(body.dailyEntrySourceId),dailyEntrySourceType:cleanText(body.dailyEntrySourceType),dailyEntryDateProperty:cleanText(body.dailyEntryDateProperty),dailyEntryTitleProperty:cleanText(body.dailyEntryTitleProperty),mapObjectId:cleanText(body.mapObjectId),mapObjectType:cleanText(body.mapObjectType),exerciseSectionBlockId:cleanText(body.exerciseSectionBlockId),timezone:cleanText(body.timezone)||DEFAULT_TIMEZONE,confirmationPreference:['risk_based','always'].includes(body.confirmationPreference)?body.confirmationPreference:'risk_based',voiceResponsePreference:body.voiceResponsePreference!==false,defaultInsertionBehavior:'match_existing'};
  if(!isValidTimezone(value.timezone))return json(res,400,{error:'Choose a valid IANA timezone such as Asia/Kolkata.'});await saveAssistantSettings(req,res,value);return json(res,200,{ok:true,settings:value});
}
const cryptoRandomId=()=>globalThis.crypto?.randomUUID?.()||`run_${Date.now()}_${Math.random().toString(36).slice(2)}`;

export default async function handler(req,res){
  res.setHeader('cache-control','no-store');const action=cleanText(new URL(req.url||'/api/assistant','https://local.invalid').searchParams.get('action')||'run');
  let current;try{current=await getSessionWithNotion(req,res);}catch{return json(res,401,{error:'Please sign in again.'});}if(!current?.user)return json(res,401,{error:'Sign in before using the assistant.'});
  if(req.method==='GET'){if(action==='settings')return settingsResponse(req,res,current);if(action==='history')return json(res,200,{runs:await listAssistantRuns(req,res,15).catch(()=>[])});return json(res,405,{error:'Unsupported assistant request.'});}
  if(req.method!=='POST'){res.setHeader('allow','GET, POST');return json(res,405,{error:'Method not allowed.'});}
  if(action==='realtime'){try{return await realtimeSession(req,res,current);}catch(error){console.warn(JSON.stringify({event:'realtime_session_failed',userId:current.user.id,status:error.status||502,message:cleanText(error.message).slice(0,160)}));return json(res,error.status&&error.status<600?error.status:502,{error:cleanText(error.message)||'Live voice could not start.'});}}
  let body;try{body=validateAssistantBody(await readBody(req));}catch(error){return json(res,400,{error:cleanText(error.message)});}
  try{
    if(action==='transcribe')return await transcribe(req,res,current,body);
    if(action==='run')return await runAgent(req,res,current,body);
    if(action==='confirm')return await confirmAction(req,res,current,body);
    if(action==='undo')return await undoAction(req,res,current,body);
    if(action==='settings')return await saveSettingsAction(req,res,body);
    return json(res,404,{error:'Unknown assistant action.'});
  }catch(error){return json(res,error.status&&error.status<600?error.status:502,{error:cleanText(error.message)||'The assistant request failed safely.'});}
}
